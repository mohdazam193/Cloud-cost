
#!/bin/bash

# Stop on first error
set -e

# ===================================================================================
# SCRIPT SETUP
# ===================================================================================

# Get the absolute path of the directory where this script is located
SCRIPT_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" &> /dev/null && pwd)

# Navigate to the project root directory (which is one level up from the script's directory)
PROJECT_ROOT=$(dirname "$SCRIPT_DIR")
cd "$PROJECT_ROOT"

# ===================================================================================
# CONFIGURATION
# ===================================================================================

# AWS Region where you want to deploy the Lambda functions
AWS_REGION="us-east-1"

# A unique name for your S3 bucket to store Lambda code.
S3_BUCKET_NAME="costinsight-lambda-code-bucket-unique-name"

# Name for the IAM Role that will be created and used by the Lambda functions
IAM_ROLE_NAME="CostInsightLambdaRole"

# Names for the Lambda functions
FETCHER_FUNCTION_NAME="CostInsight-CloudWatchFetcher"
SHUTDOWN_FUNCTION_NAME="CostInsight-AutoShutdown"

# Paths to your Lambda source code (relative to the project root)
FETCHER_LAMBDA_PATH="lambda/cloudwatch-fetcher.js"
SHUTDOWN_LAMBDA_PATH="lambda/instance-auto-shutdown.js"

# Environment variables for the CloudWatch Fetcher Lambda
# TODO: Replace with your actual backend API endpoint and a secure API key
API_ENDPOINT="https://your-backend-api.com/data"
API_KEY="your-secret-api-key"

# ===================================================================================
# SCRIPT LOGIC
# ===================================================================================

echo "Starting Lambda deployment process from project root: $PROJECT_ROOT"

# 1. Create S3 bucket for Lambda code
echo "Step 1/8: Creating S3 bucket '$S3_BUCKET_NAME'..."
if aws s3 ls "s3://$S3_BUCKET_NAME" 2>&1 | grep -q 'NoSuchBucket'; then
    aws s3 mb "s3://$S3_BUCKET_NAME" --region "$AWS_REGION"
    echo "S3 bucket created successfully."
else
    echo "S3 bucket '$S3_BUCKET_NAME' already exists. Skipping creation."
fi

# 2. Create IAM Role and attach policies
echo "Step 2/8: Creating IAM Role '$IAM_ROLE_NAME'..."

# Trust policy for Lambda
TRUST_POLICY_JSON='{
  "Version": "2012-10-17",
  "Statement": [{"Effect": "Allow", "Principal": {"Service": "lambda.amazonaws.com"}, "Action": "sts:AssumeRole"}]
}'

# Permissions policy for Lambda functions
PERMISSIONS_POLICY_JSON='{
    "Version": "2012-10-17",
    "Statement": [
        {"Effect": "Allow", "Action": ["ec2:Describe*", "ec2:StopInstances", "cloudwatch:GetMetricStatistics", "ce:GetCostAndUsage"], "Resource": "*"},
        {"Effect": "Allow", "Action": ["logs:CreateLogGroup", "logs:CreateLogStream", "logs:PutLogEvents"], "Resource": "arn:aws:logs:*:*:*"}
    ]
}'

# Create the IAM role if it doesn't exist
if ! aws iam get-role --role-name "$IAM_ROLE_NAME" >/dev/null 2>&1; then
    aws iam create-role --role-name "$IAM_ROLE_NAME" --assume-role-policy-document "$TRUST_POLICY_JSON"
    echo "IAM role '$IAM_ROLE_NAME' created."
fi

# Attach the AWS managed policy for basic Lambda execution
aws iam attach-role-policy --role-name "$IAM_ROLE_NAME" --policy-arn "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"

# Create and attach the custom permissions policy
POLICY_NAME="${IAM_ROLE_NAME}Policy"
ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
POLICY_ARN="arn:aws:iam::$ACCOUNT_ID:policy/$POLICY_NAME"

aws iam create-policy --policy-name "$POLICY_NAME" --policy-document "$PERMISSIONS_POLICY_JSON" >/dev/null 2>&1 || echo "Policy already exists."
aws iam attach-role-policy --role-name "$IAM_ROLE_NAME" --policy-arn "$POLICY_ARN"

echo "IAM role setup complete."
ROLE_ARN=$(aws iam get-role --role-name "$IAM_ROLE_NAME" --query 'Role.Arn' --output text)

echo "Waiting for IAM role propagation..."
sleep 10 # Give IAM time to propagate

# 3. Package and Upload CostInsight-CloudWatchFetcher
echo "Step 3/8: Packaging and uploading '$FETCHER_FUNCTION_NAME'..."
zip -j "${FETCHER_FUNCTION_NAME}.zip" "$FETCHER_LAMBDA_PATH"
aws s3 cp "${FETCHER_FUNCTION_NAME}.zip" "s3://$S3_BUCKET_NAME/"

# 4. Create or Update CostInsight-CloudWatchFetcher Lambda function
echo "Step 4/8: Creating/Updating Lambda function '$FETCHER_FUNCTION_NAME'..."

ENV_VARS_JSON=$(cat <<-END
{
  "Variables": {
    "API_ENDPOINT": "$API_ENDPOINT",
    "API_KEY": "$API_KEY"
  }
}
END
)

if aws lambda get-function --function-name "$FETCHER_FUNCTION_NAME" >/dev/null 2>&1; then
    echo "Updating existing function '$FETCHER_FUNCTION_NAME'..."
    aws lambda update-function-code --function-name "$FETCHER_FUNCTION_NAME" --s3-bucket "$S3_BUCKET_NAME" --s3-key "${FETCHER_FUNCTION_NAME}.zip" --publish >/dev/null
    aws lambda update-function-configuration --function-name "$FETCHER_FUNCTION_NAME" --environment "$ENV_VARS_JSON"
else
    echo "Creating new function '$FETCHER_FUNCTION_NAME'..."
    aws lambda create-function \
      --function-name "$FETCHER_FUNCTION_NAME" \
      --runtime "nodejs18.x" \
      --role "$ROLE_ARN" \
      --handler "cloudwatch-fetcher.handler" \
      --code "S3Bucket=$S3_BUCKET_NAME,S3Key=${FETCHER_FUNCTION_NAME}.zip" \
      --environment "$ENV_VARS_JSON" \
      --timeout 30 --memory-size 256 --publish
fi

# 5. Set up EventBridge trigger for the fetcher function
echo "Step 5/8: Configuring EventBridge trigger for '$FETCHER_FUNCTION_NAME'..."
RULE_NAME="CostInsight-Fetcher-Hourly-Trigger"
aws events put-rule --name "$RULE_NAME" --schedule-expression "rate(1 hour)" --state ENABLED

aws lambda add-permission \
  --function-name "$FETCHER_FUNCTION_NAME" \
  --statement-id "EventBridge-Invoke-Permission" \
  --action "lambda:InvokeFunction" \
  --principal "events.amazonaws.com" \
  --source-arn "arn:aws:events:$AWS_REGION:$ACCOUNT_ID:rule/$RULE_NAME" >/dev/null 2>&1 || echo "EventBridge permission already exists."

aws events put-targets --rule "$RULE_NAME" --targets "Id"="1","Arn"="arn:aws:lambda:$AWS_REGION:$ACCOUNT_ID:function:$FETCHER_FUNCTION_NAME"

# 6. Package and Upload CostInsight-AutoShutdown
echo "Step 6/8: Packaging and uploading '$SHUTDOWN_FUNCTION_NAME'..."
zip -j "${SHUTDOWN_FUNCTION_NAME}.zip" "$SHUTDOWN_LAMBDA_PATH"
aws s3 cp "${SHUTDOWN_FUNCTION_NAME}.zip" "s3://$S3_BUCKET_NAME/"

# 7. Create or Update CostInsight-AutoShutdown Lambda function
echo "Step 7/8: Creating/Updating Lambda function '$SHUTDOWN_FUNCTION_NAME'..."
if aws lambda get-function --function-name "$SHUTDOWN_FUNCTION_NAME" >/dev/null 2>&1; then
    echo "Updating existing function '$SHUTDOWN_FUNCTION_NAME'..."
    aws lambda update-function-code --function-name "$SHUTDOWN_FUNCTION_NAME" --s3-bucket "$S3_BUCKET_NAME" --s3-key "${SHUTDOWN_FUNCTION_NAME}.zip" --publish
else
    echo "Creating new function '$SHUTDOWN_FUNCTION_NAME'..."
    aws lambda create-function \
      --function-name "$SHUTDOWN_FUNCTION_NAME" \
      --runtime "nodejs18.x" \
      --role "$ROLE_ARN" \
      --handler "instance-auto-shutdown.handler" \
      --code "S3Bucket=$S3_BUCKET_NAME,S3Key=${SHUTDOWN_FUNCTION_NAME}.zip" \
      --timeout 15 --memory-size 128 --publish
fi

# 8. Create and configure API Gateway trigger for the shutdown function
echo "Step 8/8: Configuring API Gateway trigger for '$SHUTDOWN_FUNCTION_NAME'..."
API_NAME="CostInsight-Shutdown-API"

# Create an HTTP API
API_ID=$(aws apigatewayv2 create-api --name "$API_NAME" --protocol-type HTTP --query 'ApiId' --output text)

# Add permissions for API Gateway to invoke the Lambda
aws lambda add-permission \
  --function-name "$SHUTDOWN_FUNCTION_NAME" \
  --statement-id "APIGateway-Invoke-Permission" \
  --action "lambda:InvokeFunction" \
  --principal "apigateway.amazonaws.com" \
  --source-arn "arn:aws:execute-api:$AWS_REGION:$ACCOUNT_ID:$API_ID/*/*" >/dev/null 2>&1 || echo "API Gateway permission already exists."

# Create an integration between the API and the Lambda function
INTEGRATION_URI="arn:aws:apigateway:$AWS_REGION:lambda:path/2015-03-31/functions/arn:aws:lambda:$AWS_REGION:$ACCOUNT_ID:function:$SHUTDOWN_FUNCTION_NAME/invocations"
INTEGRATION_ID=$(aws apigatewayv2 create-integration --api-id "$API_ID" --integration-type AWS_PROXY --integration-uri "$INTEGRATION_URI" --payload-format-version 2.0 --query 'IntegrationId' --output text)

# Create a default route that directs all traffic to the Lambda
aws apigatewayv2 create-route --api-id "$API_ID" --route-key '$default' --target "integrations/$INTEGRATION_ID"

API_ENDPOINT_URL="https://$API_ID.execute-api.$AWS_REGION.amazonaws.com"

# Clean up zip files
rm "${FETCHER_FUNCTION_NAME}.zip" "${SHUTDOWN_FUNCTION_NAME}.zip"

echo "========================================================"
echo "✅ Deployment Successful!"
echo "========================================================"
echo "Summary:"
echo " - S3 Bucket: s3://$S3_BUCKET_NAME"
echo " - IAM Role: $IAM_ROLE_NAME"
echo " - Lambda Fetcher: $FETCHER_FUNCTION_NAME (triggered hourly by EventBridge)"
echo " - Lambda Shutdown: $SHUTDOWN_FUNCTION_NAME"
echo " - Shutdown API Endpoint: $API_ENDPOINT_URL"
echo "Don't forget to replace the placeholder values for API_ENDPOINT and API_KEY in the script."
