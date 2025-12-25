# CostInsight

CostInsight is a cloud cost optimization tool that provides real-time monitoring and AI-driven advice to help you reduce your cloud spending. This tool now supports both AWS and Azure, and it is deployed using Docker and Kubernetes, with monitoring provided by Prometheus and Grafana.

## Features

- **Cloud Cost Optimization:** Get actionable insights and recommendations to reduce your cloud costs.
- **AI-Driven Advice:** Leverage the power of Google's Gemini AI to get expert advice on your cloud infrastructure.
- **Real-Time Monitoring:** Monitor your cloud resources in real-time to identify and address issues as they happen.
- **Multi-Cloud Support:** Connect to both AWS and Azure to get a holistic view of your cloud spending.
- **Containerized Deployment:** The application is deployed using Docker and Kubernetes for scalability and portability.
- **Application Monitoring:** The application is monitored using Prometheus and Grafana to provide insights into its performance.

## Architecture

The application is composed of the following components:

- **Frontend:** A web-based dashboard built with HTML, CSS, and JavaScript.
- **Backend:** A Node.js application that provides a RESTful API for the frontend.
- **Database:** A MongoDB database to store user data, analysis history, and instance limits.
- **Docker:** The application is containerized using Docker for consistent and portable deployments.
- **Kubernetes:** The application is deployed to a Kubernetes cluster for scalability and high availability.
- **Prometheus:** Prometheus is used to scrape metrics from the application for monitoring.
- **Grafana:** Grafana is used to visualize the metrics collected by Prometheus.

## Getting Started

To get started with CostInsight, you will need the following:

- A Docker Hub account
- A Kubernetes cluster
- A MongoDB database
- An AWS account and/or an Azure account
- A Google Gemini API key

Once you have these prerequisites, you can deploy the application by following the instructions in the `.github/workflows/main.yaml` file.

## Local Deployment using Docker Desktop and Kubernetes

To deploy the application locally using Docker Desktop and Kubernetes, follow these steps:

1.  **Prerequisites:**
    *   [Docker Desktop](https://www.docker.com/products/docker-desktop) installed and running with Kubernetes enabled.
    *   `kubectl` command-line tool installed.
    *   Create a `.env` file in the root of the project with the following environment variables:

        ```
        MONGO_URI="your_mongodb_uri"
        GEMINI_API_KEY="your_gemini_api_key"
        JWT_SECRET="your_jwt_secret"
        ```

2.  **Update the Kubernetes Deployment:**

    *   Open the `kubernetes/deployment.yaml` file.
    *   Replace `YOUR_DOCKER_HUB_USERNAME` with your Docker Hub username.

3.  **Build and Push the Docker Image:**

    *   Log in to Docker Hub:

        ```bash
        docker login
        ```

    *   Build the Docker image:

        ```bash
        docker build -t YOUR_DOCKER_HUB_USERNAME/costinsight:latest .
        ```

    *   Push the Docker image to Docker Hub:

        ```bash
        docker push YOUR_DOCKER_HUB_USERNAME/costinsight:latest
        ```

4.  **Create Kubernetes Secrets:**

    *   Create a Kubernetes secret from the `.env` file:

        ```bash
        kubectl create secret generic costinsight-secrets --from-env-file=.env
        ```

5.  **Deploy the Application:**

    *   Apply the Kubernetes deployment and service configurations:

        ```bash
        kubectl apply -f kubernetes/deployment.yaml
        kubectl apply -f kubernetes/service.yaml
        ```

6.  **Verify the Deployment:**

    *   Check the status of the pods:

        ```bash
        kubectl get pods
        ```

        You should see the `costinsight-deployment` pods in the `Running` state.

    *   Check the status of the services:

        ```bash
        kubectl get services
        ```

        You should see the `costinsight-service` with a `LoadBalancer` type.

7.  **Access the Application:**

    *   On Docker Desktop, the service will be available on `localhost`. Open your browser and navigate to [http://localhost](http://localhost) to access the application.

## Contributing

Contributions are welcome! If you have any ideas for new features or improvements, please open an issue or submit a pull request.
