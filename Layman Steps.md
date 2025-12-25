# Layman Steps: From Your Computer to the Cloud

This guide provides a simplified, step-by-step walkthrough to get the Cloud Cost Insight application running. We'll cover running it on your own computer for testing and then deploying it to the Amazon Web Services (AWS) cloud so it can be accessed publicly on the internet.

---

## Part 1: Get the Code

First, you need to get a copy of the project's code on your computer.

1.  **Open Your Terminal (Command Prompt):** This is the application you'll use to type in all the commands.
2.  **Clone the Repository:** Copy and paste the following command and press Enter. This downloads the entire project into a new folder.
    ```bash
    git clone https://github.com/mohdazam193/Cloud-cost.git
    ```
3.  **Navigate into the Project Folder:**
    ```bash
    cd Cloud-cost
    ```

---

## Part 2: Run the App on Your Computer (for Testing)

This section explains how to run the application locally. This is perfect for seeing how it works without putting it on the internet.

### Prerequisites (Stuff to Install First)

*   **Docker:** This is a tool that packages the application so it can run anywhere. [Install Docker here](https://docs.docker.com/get-docker/).
*   **Kubernetes (via Docker Desktop):** When you install Docker Desktop, you can easily enable Kubernetes in its settings. This is what will run the application container.
*   **A Code Editor:** A tool like VS Code is helpful for editing files.

### Step-by-Step Guide

1.  **Create the Environment File:**
    *   Find the file named `.env.example` in the project folder.
    *   Make a copy of it and rename the copy to `.env`.
    *   Open the `.env` file and fill in the required keys (like your MongoDB connection string and a secret key for authentication).

2.  **Build the Application's "Box" (Docker Image):**
    *   This command packages the entire application into a "Docker image," which is like a self-contained bundle.
    *   First, log in to Docker Hub (a place to store your images):
        ```bash
        docker login
        ```
    *   Now, build the image. The name `aazammohammad193/costinsight:latest` is important, so don't change it.
        ```bash
        docker build -t aazammohammad193/costinsight:latest .
        ```

3.  **Deploy to Your Local Kubernetes:**
    *   First, tell Kubernetes about the secrets in your `.env` file securely:
        ```bash
        kubectl create secret generic costinsight-secrets --from-env-file=.env
        ```
    *   Now, apply the configurations to run the app:
        ```bash
        kubectl apply -f kubernetes/deployment.yaml
        kubectl apply -f kubernetes/service.yaml
        ```

4.  **Check if It's Running:**
    *   Use these commands to see the status:
        ```bash
        kubectl get pods
        kubectl get services
        ```
    *   You should see a pod named `costinsight-deployment-...` with a status of `Running`.

5.  **Access the Application:**
    *   Open your web browser and go to: **[http://localhost](http://localhost)**
    *   You should now see the application's login page!

---

## Part 3: Deploy to the Cloud (Amazon EKS)

Now, let's put the application on the internet so anyone can access it. We will use Amazon Elastic Kubernetes Service (EKS).

### Prerequisites

*   **An AWS Account:** You'll need an account with Amazon Web Services.
*   **AWS CLI:** The command-line tool for interacting with AWS. [Install it here](https://aws.amazon.com/cli/).
*   **eksctl:** A simple tool for creating and managing EKS clusters. [Install it here](https://eksctl.io/introduction/#installation).

### Step-by-Step Guide

1.  **Configure your AWS CLI:**
    *   Set up your AWS credentials so your computer can talk to your AWS account.
        ```bash
        aws configure
        ```
    *   You'll be asked for your AWS Access Key ID, Secret Access Key, and default region.

2.  **Create Your Kubernetes Cluster in AWS:**
    *   This command creates a managed Kubernetes cluster in your AWS account. It can take 15-20 minutes, so be patient!
        ```bash
        eksctl create cluster --name costinsight-cluster --region us-east-1 --nodegroup-name standard-workers --node-type t3.medium --nodes 2
        ```
    *   Once it's finished, `eksctl` will automatically configure your `kubectl` to communicate with your new cloud cluster.

3.  **Push Your Docker Image to a Public Registry:**
    *   The Kubernetes cluster in the cloud needs a way to download your application's "box" (the Docker image). We'll use Docker Hub for this.
    *   If you haven't already, log in:
        ```bash
        docker login
        ```
    *   Push the image you built earlier to Docker Hub:
        ```bash
        docker push aazammohammad193/costinsight:latest
        ```

4.  **Deploy the Application to EKS:**
    *   The process is the same as deploying locally. First, create the secret:
        ```bash
        kubectl create secret generic costinsight-secrets --from-env-file=.env
        ```
    *   Then, apply the deployment and service files:
        ```bash
        kubectl apply -f kubernetes/deployment.yaml
        kubectl apply -f kubernetes/service.yaml
        ```

5.  **Find Your Public Website Address:**
    *   The `service.yaml` file is configured to create a `LoadBalancer`. This automatically creates a public, internet-facing address for your website.
    *   Run this command and wait for the `EXTERNAL-IP` to appear (it might take a few minutes):
        ```bash
        kubectl get service costinsight-service -w
        ```
    *   The output will look like this:
        ```
        NAME                  TYPE           CLUSTER-IP      EXTERNAL-IP                                                             PORT(S)        AGE
        costinsight-service   LoadBalancer   10.100.200.30   a1b2c3d4e5.us-east-1.elb.amazonaws.com   80:31234/TCP   2m
        ```
    *   The long address under `EXTERNAL-IP` is your public website URL! Copy it into your browser to see your live application.

---

## Part 4: Set Up Automated AWS Tasks (Lambda)

This project uses two serverless functions in AWS to automate fetching cloud metrics.

1.  **Configure the Deployment Script:**
    *   Open the file `aws-cli/deploy_lambdas.sh`.
    *   Find this section:
        ```bash
        # Environment variables for the CloudWatch Fetcher Lambda
        # IMPORTANT: Replace this with the public URL of your backend API.
        # Example: https://myapp.com/api/cloud-data
        API_ENDPOINT="REPLACE_WITH_YOUR_BACKEND_API_ENDPOINT"
        API_KEY="REPLACE_WITH_A_STRONG_SECRET_KEY"
        ```
    *   **`API_ENDPOINT`**: Replace `"REPLACE_WITH_YOUR_BACKEND_API_ENDPOINT"` with your public website address from the previous step, followed by `/api/lambda-data`. For example: `http://a1b2c3d4e5.us-east-1.elb.amazonaws.com/api/lambda-data`
    *   **`API_KEY`**: Replace `"REPLACE_WITH_A_STRONG_SECRET_KEY"` with a long, random password. You must also add this same key to your `.env` file as `API_KEY="your-chosen-key"`.

2.  **Run the Deployment Script:**
    *   This script does all the heavy lifting of setting up the functions in AWS.
        ```bash
        bash aws-cli/deploy_lambdas.sh
        ```

---

## Part 5: View Monitoring Dashboards (Grafana)

The project includes Grafana for visualizing metrics.

1.  **Deploy Grafana:**
    *   Apply the Grafana configuration files to your cluster:
        ```bash
        kubectl apply -f kubernetes/grafana-deployment.yaml
        kubectl apply -f kubernetes/grafana-service.yaml
        ```

2.  **Access the Grafana Dashboard (from your local machine):**
    *   Forward the Grafana service port to your computer:
        ```bash
        kubectl port-forward svc/grafana-service 3000:3000
        ```
    *   Open your browser and go to `http://localhost:3000`.
    *   Log in with username `admin` and password `admin`. You'll be asked to change it.
    *   Inside Grafana, add "Prometheus" as a new data source. When asked for the URL, use `http://prometheus-service:9090`. Now you can create dashboards to see your application's performance!
