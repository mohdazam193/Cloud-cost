# CostInsight Deployment Instructions

This guide provides comprehensive instructions for setting up, configuring, and deploying the CostInsight application and its related components.

## Table of Contents

1.  [MongoDB Setup](#1-mongodb-setup)
2.  [Local Deployment with Docker and Kubernetes](#2-local-deployment-with-docker-and-kubernetes)
3.  [AWS Lambda Function Deployment](#3-aws-lambda-function-deployment)
4.  [Application Monitoring with Prometheus and Grafana](#4-application-monitoring-with-prometheus-and-grafana)

---

## 1. MongoDB Setup

The application requires a MongoDB database to store user data, analysis history, and other application-related information. For development and production, we recommend using MongoDB Atlas, which offers a generous free tier.

### Steps to Set Up a MongoDB Atlas Cluster:

1.  **Create a Free Account:**
    *   Go to the [MongoDB Atlas website](https://www.mongodb.com/cloud/atlas/register) and sign up for a new account.

2.  **Create a Free Cluster:**
    *   After signing up, you will be guided to create a new cluster. Choose the **M0 (Free)** cluster tier.
    *   Select a cloud provider and region of your choice (e.g., AWS, `us-east-1`).
    *   Give your cluster a name (e.g., `CostInsight-Cluster`) and click **Create Cluster**.

3.  **Configure Database User and Network Access:**
    *   **Database User:** In your cluster's dashboard, go to the **Database Access** tab. Click **Add New Database User**, create a username and password, and give the user `Read and write to any database` permissions.
    *   **Network Access:** Go to the **Network Access** tab. Click **Add IP Address**. For local development, you can select **Allow Access from Anywhere** (0.0.0.0/0). For production, you should restrict this to your application server's IP address.

4.  **Get the Connection String:**
    *   In your cluster's main dashboard, click the **Connect** button.
    *   Select **Connect your application**.
    *   Choose the **Node.js** driver and the latest version.
    *   Copy the provided **Connection String**. It will look something like this:
        ```
        mongodb+srv://<username>:<password>@cluster0.xxxxx.mongodb.net/?retryWrites=true&w=majority
        ```
    *   Replace `<username>` and `<password>` with the credentials of the database user you created in the previous step. This full connection string is your `MONGO_URI`.

---

## 2. Local Deployment with Docker and Kubernetes

These instructions will guide you through deploying the application on your local machine using Docker Desktop's built-in Kubernetes cluster.

### A. Prerequisites:

*   [Node.js](https://nodejs.org/en/download/) (v18 or later)
*   [Docker Desktop](https://www.docker.com/products/docker-desktop) installed and running.
*   **Kubernetes enabled in Docker Desktop:**
    *   Go to Docker Desktop's **Settings** > **Kubernetes**.
    *   Check the box for **Enable Kubernetes**.
*   `kubectl` command-line tool installed and configured to use the `docker-desktop` context.

### B. Configuration:

1.  **Create a `.env` file** in the root directory of the project.
2.  **Add the following environment variables** to the `.env` file:

    ```env
    # Your MongoDB Atlas connection string from the previous section
    MONGO_URI="mongodb+srv://..."

    # Your Google Gemini API Key for AI-driven advice
    GEMINI_API_KEY="your_gemini_api_key"

    # A long, random string for signing JWT tokens
    JWT_SECRET="your_super_secret_jwt_string"
    ```

### C. Build and Push the Docker Image:

1.  **Log in to Docker Hub** from your terminal:
    ```bash
    docker login
    ```

2.  **Build the Docker image**. The tag `aazammohammad193/costinsight:latest` is already configured in the Kubernetes files.
    ```bash
    docker build -t aazammohammad193/costinsight:latest .
    ```

3.  **Push the image to Docker Hub**:
    ```bash
    docker push aazammohammad193/costinsight:latest
    ```

### D. Deploy to Kubernetes:

1.  **Create a Kubernetes secret** to securely store your environment variables:
    ```bash
    kubectl create secret generic costinsight-secrets --from-env-file=.env
    ```

2.  **Apply the deployment and service configurations**:
    ```bash
    kubectl apply -f kubernetes/deployment.yaml
    kubectl apply -f kubernetes/service.yaml
    ```

### E. Verify and Access the Application:

1.  **Check the status** of the deployment:
    ```bash
    kubectl get pods
    kubectl get services
    ```
    You should see the `costinsight-deployment` pod in the `Running` state and the `costinsight-service` available.

2.  **Access the application** by opening your web browser and navigating to:
    [http://localhost](http://localhost)

---

## 3. AWS Lambda Function Deployment

The application uses two AWS Lambda functions for automated tasks. They must be deployed separately in your AWS account. You can deploy them manually by following the steps below, or use the automated script for a quicker setup.

### A. Manual Deployment: `cloudwatch-fetcher`

This function periodically fetches EC2 metrics from CloudWatch and sends them to your main application.

1.  **Create IAM Role:**
    *   Navigate to **IAM > Roles** in the AWS Console and click **Create role**.
    *   **Trusted entity:** AWS service, **Use case:** Lambda.
    *   **Permissions:** Attach the following AWS managed policies:
        *   `AWSLambdaBasicExecutionRole` (for logs)
        *   `CloudWatchReadOnlyAccess`
        *   `AmazonEC2ReadOnlyAccess`
    *   **Role name:** `CostInsight-CloudWatchFetcher-Role`.

2.  **Create Lambda Function:**
    *   Navigate to the **Lambda** service and click **Create function**.
    *   **Name:** `CostInsight-CloudWatchFetcher`
    *   **Runtime:** Node.js 18.x
    *   **Permissions:** Use an existing role and select `CostInsight-CloudWatchFetcher-Role`.
    *   Create the function.

3.  **Configure Code and Environment:**
    *   Copy the full content of `lambda/cloudwatch-fetcher.js` into the **Code source** editor and click **Deploy**.
    *   Go to **Configuration > Environment variables** and add:
        *   `API_ENDPOINT`: The public URL of your application's API. For local testing, you may need a tool like `ngrok` to get a public URL for `http://localhost:3000`.
        *   `API_KEY`: Your `JWT_SECRET` value from the `.env` file.
        *   `AWS_REGION`: The AWS region you wish to monitor (e.g., `us-east-1`).

4.  **Set Up Trigger:**
    *   In the function overview, click **Add trigger**.
    *   Select **EventBridge (CloudWatch Events)**.
    *   Choose **Create a new rule**.
    *   **Rule name:** `CostInsight-Daily-Trigger`.
    *   **Schedule expression:** `rate(1 day)`.
    *   Click **Add**.

### B. Manual Deployment: `instance-auto-shutdown`

This function stops an EC2 instance when triggered by your application.

1.  **Create IAM Role:**
    *   Create another IAM role for Lambda named `CostInsight-AutoShutdown-Role`.
    *   **Permissions:** Attach the following policies:
        *   `AWSLambdaBasicExecutionRole`
        *   `AmazonEC2FullAccess` (For better security, create a custom policy allowing only `ec2:StopInstances` and `ec2:DescribeInstances`).

2.  **Create Lambda Function:**
    *   Create a new Lambda function named `CostInsight-AutoShutdown`.
    *   **Runtime:** Node.js 18.x
    *   **Permissions:** Use the `CostInsight-AutoShutdown-Role`.

3.  **Configure Code:**
    *   Copy the content of `lambda/instance-auto-shutdown.js` into the **Code source** editor and click **Deploy**.

4.  **Set Up API Gateway Trigger:**
    *   Click **Add trigger** and select **API Gateway**.
    *   Choose **Create a new API**.
    *   **API type:** HTTP API.
    *   **Security:** Open.
    *   Click **Add**.
    *   The **API endpoint** URL will be displayed. You will need to configure this URL in your main application's settings so it can call this Lambda function.

### C. Automated Deployment with AWS CLI

For a faster, more streamlined deployment, you can use the provided `deploy_lambdas.sh` script. This script automates the creation of the IAM roles, packaging the Lambda code, and deploying the functions.

**Prerequisites:**

*   [AWS CLI](https://aws.amazon.com/cli/) installed and configured with your AWS credentials.
*   The `zip` command-line tool must be installed.

**Steps:**

1.  **Make the script executable:**
    ```bash
    chmod +x aws-cli/deploy_lambdas.sh
    ```

2.  **Update the S3 Bucket Name:**
    Open the `aws-cli/deploy_lambdas.sh` file and replace the placeholder value for `S3_BUCKET_NAME` with a globally unique S3 bucket name.
    ```bash
    # TODO: Replace with your desired unique S3 bucket name.
    S3_BUCKET_NAME="costinsight-lambda-code-bucket-your-unique-name"
    ```

3.  **Run the deployment script** from the root of the project:
    ```bash
    ./aws-cli/deploy_lambdas.sh
    ```

The script will handle the creation of all necessary AWS resources. After the script finishes, it will output the names of the created resources. You will still need to manually configure the API Gateway and EventBridge triggers as described in the manual steps.

---

## 4. Application Monitoring with Prometheus and Grafana

To monitor your application's performance and resource usage, Prometheus and Grafana have been pre-configured.

### A. Deploy Monitoring Components:

1.  **Apply all the Kubernetes configurations**, including the new monitoring files:
    ```bash
    kubectl apply -f kubernetes/
    ```
    This command will deploy Prometheus and Grafana alongside your application.

### B. Accessing the Dashboards:

1.  **Access the Prometheus Dashboard:**
    *   Use the following command to forward the Prometheus service port to your local machine:
        ```bash
        kubectl port-forward svc/prometheus-service 9090:9090
        ```
    *   Open your web browser and navigate to `http://localhost:9090`. You can use the query builder to explore metrics, such as `http_requests_total`.

2.  **Access the Grafana Dashboard:**
    *   Forward the Grafana service port:
        ```bash
        kubectl port-forward svc/grafana-service 3000:3000
        ```
    *   Open your web browser and go to `http://localhost:3000`.
    *   The default login is `admin` for both username and password. You will be prompted to change the password upon first login.
    *   To view application metrics, you'll need to add Prometheus as a data source (URL: `http://prometheus-service:9090`) and create a new dashboard.
