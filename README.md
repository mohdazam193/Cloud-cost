# CostInsight: AI-Powered Cloud Cost Optimization

[![MIT License](https://img.shields.io/badge/License-MIT-green.svg)](https://choosealicense.com/licenses/mit/)
[![Build Status](https://img.shields.io/travis/com/mohdazam193/Cloud-cost.svg?style=flat-square)](https://travis-ci.com/github/mohdazam193/Cloud-cost)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg?style=flat-square)](http://makeapullrequest.com)

> A comprehensive, multi-cloud cost optimization and monitoring platform. CostInsight provides real-time insights and AI-driven recommendations to minimize your cloud expenditure.

<br />
<p align="center">
  <a href="https://github.com/mohdazam193/Cloud-cost">
    <!-- <img src="images/logo.png" alt="Logo" width="80" height="80"> -->
  </a>

  <h3 align="center">CostInsight</h3>

  <p align="center">
    Monitor your cloud, get AI advice, and cut costs.
    <br />
    <a href="https://github.com/mohdazam193/Cloud-cost"><strong>Explore the docs »</strong></a>
    <br />
    <br />
    <a href="https://github.com/mohdazam193/Cloud-cost/issues">Report Bug</a>
    ·
    <a href="https://github.com/mohdazam193/Cloud-cost/issues">Request Feature</a>
  </p>
</p>

<!-- TABLE OF CONTENTS -->
<details>
  <summary>Table of Contents</summary>
  <ol>
    <li>
      <a href="#about-the-project">About The Project</a>
      <ul>
        <li><a href="#-key-features">Key Features</a></li>
        <li><a href="#-built-with">Built With</a></li>
      </ul>
    </li>
    <li>
      <a href="#-getting-started">Getting Started</a>
      <ul>
        <li><a href="#prerequisites">Prerequisites</a></li>
        <li><a href="#-local-deployment-for-testing">Local Deployment</a></li>
        <li><a href="#-cloud-deployment-amazon-eks">Cloud Deployment</a></li>
      </ul>
    </li>
    <li><a href="#-usage">Usage</a></li>
    <li><a href="#-roadmap">Roadmap</a></li>
    <li><a href="#-contributing">Contributing</a></li>
    <li><a href="#-license">License</a></li>
    <li><a href="#-contact">Contact</a></li>
  </ol>
</details>

---

## About The Project

```mermaid
graph TD
    subgraph "User's Browser"
        A[User] --> B[React Frontend];
    end

    subgraph "Kubernetes Cluster (EKS)"
        B --> C{Load Balancer};
        C --> D[Backend API (Node.js)];
        D --> E[MongoDB];
        D --> F[Prometheus];
        F --> G[Grafana];
    end

    subgraph "External Services"
        D --> H[Google Gemini AI];
    end

    subgraph "AWS Infrastructure"
        I[AWS Lambda] -- Pushes Data --> C;
        J[CloudWatch Metrics] --> I;
    end

    style B fill:#61DAFB,stroke:#333,stroke-width:2px
    style D fill:#8CC84B,stroke:#333,stroke-width:2px
    style E fill:#4DB33D,stroke:#333,stroke-width:2px
    style F fill:#E6522C,stroke:#333,stroke-width:2px
    style G fill:#F47E20,stroke:#333,stroke-width:2px
    style H fill:#4285F4,stroke:#333,stroke-width:2px
    style I fill:#FF9900,stroke:#333,stroke-width:2px
```

CostInsight was born from the need for a centralized, intelligent platform to manage the complexities of cloud spending. In a multi-cloud world, it's easy to lose track of resources, leading to budget overruns and inefficient infrastructure.

This platform connects directly to your AWS account to pull real-time metrics, analyzes them using Google's powerful Gemini AI, and presents you with clear, actionable recommendations. Whether you're an individual developer or a large enterprise, CostInsight provides the tools to take control of your cloud costs.

For a simplified, step-by-step guide, please refer to the **[Layman Steps Guide](Layman%20Steps.md)**.

### ✨ Key Features

*   **Real-Time AWS Monitoring:** Live data on EC2, EBS, RDS, Lambda, and more.
*   **🤖 AI-Driven Recommendations:** Utilizes the Gemini AI API for actionable cost-saving advice.
*   **📊 Historical Data Analysis:** Track spending and resource utilization over time.
*   **💬 Interactive Chatbot:** Ask questions about your infrastructure in natural language.
*   **⚙️ Automated Instance Policies:** Set CPU thresholds for alerts or automatic shutdowns.
*   **☁️ Serverless Data Fetching:** AWS Lambda functions keep your data fresh.
*   **🚀 Scalable by Design:** Built on Docker and Kubernetes (EKS) for high availability.
*   **📈 Advanced Monitoring:** Pre-configured support for Prometheus and Grafana.

### Built With

This project is built on a modern, scalable technology stack.

| Tech          | Description                          |
|---------------|--------------------------------------|
| **Backend**   | Node.js, Express.js                  |
| **Database**  | MongoDB                              |
| **AI**        | Google Gemini                        |
| **Frontend**  | (Not specified, assumed to be part of the stack) |
| **Container** | Docker                               |
| **Orchestration**| Kubernetes (Amazon EKS)             |
| **Monitoring**| Prometheus, Grafana                  |
| **Cloud**     | AWS (EC2, EKS, Lambda, S3, IAM)      |

---

## 🏁 Getting Started

Follow these steps to get a local copy up and running.

### Prerequisites

Ensure you have the following tools installed and configured:
*   **npm**
    ```sh
    npm install npm@latest -g
    ```
*   **Docker Desktop**: [Download](https://www.docker.com/products/docker-desktop)
    * Make sure to enable Kubernetes in the settings.
*   **AWS CLI**: [Installation Guide](https://docs.aws.amazon.com/cli/latest/userguide/cli-chap-install.html)
*   **eksctl**: [Installation Guide](https://eksctl.io/introduction/#installation)
*   **MongoDB Atlas Account**: [Create one here](https://www.mongodb.com/cloud/atlas/register)

### 💻 Local Deployment (for Testing)

1.  **Clone the repo**
    ```sh
    git clone https://github.com/mohdazam193/Cloud-cost.git
    cd Cloud-cost
    ```
2.  **Configure Environment**
    *   Copy `.env.example` to `.env`.
    *   Fill in all the required variables like `MONGO_URI`, `GEMINI_API_KEY`, etc.
3.  **Deploy to local Kubernetes**
    ```sh
    # Create the secret
    kubectl create secret generic costinsight-secrets --from-env-file=.env

    # Apply the manifests
    kubectl apply -f kubernetes/deployment.yaml
    kubectl apply -f kubernetes/service.yaml
    ```
4.  **Access the App**
    *   Open your browser to `http://localhost`.

### ☁️ Cloud Deployment (Amazon EKS)

1.  **Create an EKS Cluster**
    ```sh
    eksctl create cluster --name costinsight-cluster --region us-east-1 --nodes 2
    ```
2.  **Push the Docker Image**
    *   Build and push the image to a public registry like Docker Hub.
    ```sh
    docker build -t your-username/costinsight:latest .
    docker push your-username/costinsight:latest
    ```
    *   **Important:** Update the `image` name in `kubernetes/deployment.yaml` to point to your repository.
3.  **Deploy to EKS**
    ```sh
    kubectl apply -f kubernetes/deployment.yaml
    kubectl apply -f kubernetes/service.yaml
    ```
    *   Find your public URL by running `kubectl get service costinsight-service`.
4.  **Deploy Lambda Functions**
    *   Update the `API_ENDPOINT` and `API_KEY` in `aws-cli/deploy_lambdas.sh`.
    *   Run the script:
    ```sh
    bash aws-cli/deploy_lambdas.sh
    ```

---

## Usage

Once deployed, CostInsight provides a user-friendly dashboard to monitor your AWS resources. The interactive chatbot can be used to ask specific questions like:

> "Show me all EC2 instances with CPU utilization below 5% for the last 7 days."

> "What are the top 3 cost-saving recommendations for my account?"

### AI Recommendation Flow

The following diagram illustrates how the application generates cost-saving advice:

```mermaid
sequenceDiagram
    participant User
    participant Frontend
    participant BackendAPI as Backend API
    participant MongoDB
    participant GeminiAI as Google Gemini AI

    User->>Frontend: Request AI Recommendations
    Frontend->>BackendAPI: GET /api/recommendations
    BackendAPI->>MongoDB: Fetch latest cloud metrics
    MongoDB-->>BackendAPI: Return metrics data
    BackendAPI->>GeminiAI: Send prompt with metrics data
    GeminiAI-->>BackendAPI: Return generated recommendations
    BackendAPI->>Frontend: Send recommendations
    Frontend-->>User: Display recommendations
```

---

## 🗺️ Roadmap

-   [ ] Add support for Google Cloud Platform (GCP) and Microsoft Azure.
-   [ ] Implement user roles and permissions.
-   [ ] Create more detailed and customizable dashboards.
-   [ ] Develop an alerting system for budget anomalies.

See the [open issues](https://github.com/mohdazam193/Cloud-cost/issues) for a full list of proposed features (and known issues).

---

## 🤝 Contributing

Contributions are what make the open source community such an amazing place to learn, inspire, and create. Any contributions you make are **greatly appreciated**.

If you have a suggestion that would make this better, please fork the repo and create a pull request. You can also simply open an issue with the tag "enhancement".
Don't forget to give the project a star! Thanks again!

1.  Fork the Project
2.  Create your Feature Branch (`git checkout -b feature/AmazingFeature`)
3.  Commit your Changes (`git commit -m '''Add some AmazingFeature'''`)
4.  Push to the Branch (`git push origin feature/AmazingFeature`)
5.  Open a Pull Request

---

## 📄 License

Distributed under the MIT License. See `LICENSE` for more information.

---

## 📧 Contact

Project Admin - admin@example.com

Project Link: [https://github.com/mohdazam193/Cloud-cost](https://github.com/mohdazam193/Cloud-cost)
