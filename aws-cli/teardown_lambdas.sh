
#!/bin/bash

# Stop on first error
set -e

# ===================================================================================
# CONFIGURATION
# ===================================================================================

# AWS Region where the resources were deployed
AWS_REGION="us-east-1"

# The S3 bucket name used during deployment
S3_BUCKET_NAME="costinsight-lambda-code-bucket-unique-name"

# The IAM Role name
IAM_ROLE_NAME="CostInsightLambdaRole"

# The names of the Lambda functions
FETCHER_FUNCTION_NAME="CostInsight-CloudWatchFetcher"
SHUTDOWN_FUNCTION_NAME="CostInsight-AutoShutdown"

# The name of the EventBridge rule
EVENTBRIDGE_RULE_NAME="CostInsight-Fetcher-Hourly-Trigger"

# The name of the API Gateway API
API_GATEWAY_NAME="CostInsight-Shutdown-API"

# ===================================================================================
# SCRIPT LOGIC
# ===================================================================================

echo "Starting AWS resource teardown process..."

# 1. Delete the API Gateway
echo "Step 1/5: Deleting API Gateway '$API_GATEWAY_NAME'..."
API_ID=$(aws apigatewayv2 get-apis --query "Items[?Name=='$API_GATEWAY_NAME'].ApiId" --output text)
if [ -n "$API_ID" ]; then
    aws apigatewayv2 delete-api --api-id "$API_ID"
    echo "API Gateway deleted successfully."
else
    echo "API Gateway not found. Skipping."
fi

# 2. Delete the EventBridge Rule and its Targets
echo "Step 2/5: Deleting EventBridge rule '$EVENTBRIDGE_RULE_NAME'..."
if aws events describe-rule --name "$EVENTBRIDGE_RULE_NAME" >/dev/null 2>&1; then
    # Remove targets from the rule first
    TARGET_IDS=$(aws events list-targets-by-rule --rule "$EVENTBRIDGE_RULE_NAME" --query "Targets[*].Id" --output text)
    if [ -n "$TARGET_IDS" ]; then
        aws events remove-targets --rule "$EVENTBRIDGE_RULE_NAME" --ids $TARGET_IDS
    fi
    aws events delete-rule --name "$EVENTBRIDGE_RULE_NAME"
    echo "EventBridge rule deleted successfully."
else
    echo "EventBridge rule not found. Skipping."
fi

# 3. Delete the Lambda Functions
echo "Step 3/5: Deleting Lambda functions..."
for FUNCTION_NAME in $FETCHER_FUNCTION_NAME $SHUTDOWN_FUNCTION_NAME; do
    if aws lambda get-function --function-name "$FUNCTION_NAME" >/dev/null 2>&1; then
        aws lambda delete-function --function-name "$FUNCTION_NAME"
        echo " - Lambda function '$FUNCTION_NAME' deleted."
    else
        echo " - Lambda function '$FUNCTION_NAME' not found. Skipping."
    fi
done

# 4. Delete the IAM Role and Policies
echo "Step 4/5: Deleting IAM role '$IAM_ROLE_NAME' and associated policies..."
if aws iam get-role --role-name "$IAM_ROLE_NAME" >/dev/null 2>&1; then
    ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
    POLICY_NAME="${IAM_ROLE_NAME}Policy"
    POLICY_ARN="arn:aws:iam::$ACCOUNT_ID:policy/$POLICY_NAME"

    # Detach policies
    echo " - Detaching policies from role '$IAM_ROLE_NAME'..."
    aws iam detach-role-policy --role-name "$IAM_ROLE_NAME" --policy-arn "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole" || echo "Managed policy not attached."
    aws iam detach-role-policy --role-name "$IAM_ROLE_NAME" --policy-arn "$POLICY_ARN" || echo "Custom policy not attached."

    # Delete the custom policy
    if aws iam get-policy --policy-arn "$POLICY_ARN" >/dev/null 2>&1; then
        aws iam delete-policy --policy-arn "$POLICY_ARN"
        echo " - Custom policy '$POLICY_NAME' deleted."
    else
        echo " - Custom policy not found. Skipping."
    fi

    # Delete the role
    aws iam delete-role --role-name "$IAM_ROLE_NAME"
    echo "IAM role '$IAM_ROLE_NAME' deleted successfully."
else
    echo "IAM role not found. Skipping."
fi

# 5. Empty and Delete the S3 Bucket
echo "Step 5/5: Emptying and deleting S3 bucket '$S3_BUCKET_NAME'..."
if aws s3 ls "s3://$S3_BUCKET_NAME" --region "$AWS_REGION" >/dev/null 2>&1; then
    aws s3 rb "s3://$S3_BUCKET_NAME" --force
    echo "S3 bucket deleted successfully."
else
    echo "S3 bucket not found. Skipping."
fi

echo "========================================================"
echo "✅ Teardown Successful!"
echo "========================================================"
echo "All associated AWS resources have been deleted."
