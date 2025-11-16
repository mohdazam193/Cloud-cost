const express = require('express');
const cors = require('cors');
const { MongoClient, ServerApiVersion } = require('mongodb');
const path = require('path');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

// Google Generative AI SDK
const { GoogleGenerativeAI } = require('@google/generative-ai');
const https = require('https');

// AWS SDK imports
const { CloudWatchClient, GetMetricStatisticsCommand, ListMetricsCommand } = require('@aws-sdk/client-cloudwatch');
const { EC2Client, DescribeInstancesCommand, DescribeVolumesCommand, DescribeSnapshotsCommand, StopInstancesCommand } = require('@aws-sdk/client-ec2');
const { CostExplorerClient, GetCostAndUsageCommand, GetCostForecastCommand } = require('@aws-sdk/client-cost-explorer');
const { LambdaClient, ListFunctionsCommand, InvokeCommand } = require('@aws-sdk/client-lambda');
const { RDSClient, DescribeDBInstancesCommand } = require('@aws-sdk/client-rds');

const app = express();
const port = process.env.PORT || 3000;
const MONGO_URI = process.env.MONGO_URI;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const JWT_SECRET = process.env.JWT_SECRET || 'fallback_secret_key_change_me';
const AWS_REGION = process.env.AWS_REGION || 'us-east-1';

// ========== GEMINI AI ROBUST INITIALIZATION ==========
let genAI = null;
let workingModel = null;
let cachedAvailableModels = [];
let cachedModelsFetchedAt = 0;

const MODEL_PRIORITY = [
    'gemini-1.5-flash-latest',
    'gemini-1.5-pro-latest',
    'gemini-1.5-flash',
    'gemini-1.5-pro',
    'gemini-pro-latest',
    'gemini-pro'
];

const MODEL_CACHE_TTL = 5 * 60 * 1000; // 5 minutes
const MAX_ATTEMPTS_PER_MODEL = 3;
const BASE_RETRY_DELAY_MS = 1500;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function isModelMissingError(error) {
    return (
        error?.status === 404 ||
        error?.message?.toLowerCase().includes('not found') ||
        error?.message?.toLowerCase().includes('not have access')
    );
}

function isRateLimitError(error) {
    return (
        error?.status === 429 ||
        error?.message?.toLowerCase().includes('quota') ||
        error?.message?.toLowerCase().includes('too many requests') ||
        error?.message?.toLowerCase().includes('rate limit')
    );
}

function isOverloadedError(error) {
    return (
        error?.status === 503 ||
        error?.message?.toLowerCase().includes('overloaded') ||
        error?.message?.toLowerCase().includes('service unavailable')
    );
}

// Fetch available models from Google API
async function fetchAvailableModels() {
    return new Promise((resolve) => {
        try {
            const url = `https://generativelanguage.googleapis.com/v1beta/models?key=${GEMINI_API_KEY}`;
            https.get(url, (res) => {
                let data = '';
                res.on('data', (chunk) => { data += chunk; });
                res.on('end', () => {
                    try {
                        const jsonData = JSON.parse(data);
                        if (jsonData.models) {
                            const models = jsonData.models
                                .filter((model) => model.supportedGenerationMethods?.includes('generateContent'))
                                .map((model) => model.name.replace('models/', ''));
                            resolve(models);
                        } else {
                            resolve([]);
                        }
                    } catch (error) {
                        resolve([]);
                    }
                });
            }).on('error', () => resolve([]));
        } catch (error) {
            resolve([]);
        }
    });
}

async function getAvailableModels(forceRefresh = false) {
    const now = Date.now();
    if (!forceRefresh && cachedAvailableModels.length && now - cachedModelsFetchedAt < MODEL_CACHE_TTL) {
        return cachedAvailableModels;
    }
    const models = await fetchAvailableModels();
    if (models.length) {
        cachedAvailableModels = models;
        cachedModelsFetchedAt = now;
    }
    return models;
}

async function getModelCandidates(exclude = []) {
    const availableModels = await getAvailableModels();
    let candidates;
    if (availableModels.length) {
        const prioritized = MODEL_PRIORITY.filter((model) => availableModels.includes(model));
        const remaining = availableModels.filter((model) => !prioritized.includes(model));
        candidates = [...prioritized, ...remaining];
    } else {
        candidates = [...MODEL_PRIORITY];
    }
    return candidates.filter((model) => !exclude.includes(model));
}

async function findWorkingModel() {
    const candidates = await getModelCandidates();
    if (candidates.length === 0) {
        return null;
    }
    return candidates[0];
}

// Try to generate content with automatic model fallback
async function generateWithGemini(prompt) {
    if (!genAI) {
        throw new Error('Gemini AI not initialized');
    }

    const triedModels = [];
    let finalError = null;

    while (true) {
        let modelName = null;

        if (workingModel && !triedModels.includes(workingModel)) {
            modelName = workingModel;
        } else {
            const candidates = await getModelCandidates(triedModels);
            if (!candidates.length) {
                break;
            }
            modelName = candidates[0];
        }

        triedModels.push(modelName);
        const model = genAI.getGenerativeModel({ 
            model: modelName,
            generationConfig: {
                temperature: 0.9,
                maxOutputTokens: 2048,
            }
        });

        let attempt = 0;
        while (attempt < MAX_ATTEMPTS_PER_MODEL) {
            attempt++;
            try {
                const result = await model.generateContent(prompt);
                const response = await result.response;
                const text = response.text();

                workingModel = modelName;
                console.log(`✅ Gemini response generated with model: ${modelName}`);
                return text;
            } catch (error) {
                finalError = error;
                console.error(`⚠️ Model ${modelName} attempt ${attempt} failed: ${error.message}`);

                if (isRateLimitError(error) || isOverloadedError(error)) {
                    await sleep(attempt * BASE_RETRY_DELAY_MS);
                    continue;
                }

                if (isModelMissingError(error)) {
                    if (workingModel === modelName) {
                        workingModel = null;
                    }
                    break;
                }

                break;
            }
        }
    }

    throw finalError || new Error('No working Gemini models available');
}

// Initialize Gemini
if (GEMINI_API_KEY && GEMINI_API_KEY !== 'your_gemini_api_key_here') {
    genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
    console.log("✅ Gemini AI client initialized");
    
    // Discover working model on startup (async)
    findWorkingModel().then(model => {
        if (model) {
            workingModel = model;
            console.log(`🤖 Using Gemini model: ${workingModel}`);
        }
    }).catch(() => {
        console.log('🤖 Gemini model: will auto-detect on first request');
    });
} else {
    console.log("⚠️ Gemini API Key not configured");
}

// AWS credentials for simulation/testing
const MOCK_AWS_ACCESS_KEY = process.env.MOCK_AWS_ACCESS_KEY;
const MOCK_AWS_SECRET_KEY = process.env.MOCK_AWS_SECRET_KEY;

// --- Middlewares ---
app.use(cors({
    origin: process.env.NODE_ENV === 'production' 
        ? process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : '*'
        : '*',
    credentials: true
}));
app.use(express.json());
app.use(express.static(path.join(__dirname, '../frontend'))); // Serve static files

// --- MongoDB Connection Simulation ---
let db;
let usersCollection;
let historyCollection;
let instanceLimitsCollection;
let awsCredentialsCollection;

const mongoClient = new MongoClient(MONGO_URI, {
    serverApi: {
        version: ServerApiVersion.v1,
        strict: true,
        deprecationErrors: true,
    }
});

async function connectDB() {
    try {
        console.log("Attempting to connect to MongoDB...");
        await mongoClient.connect();
        db = mongoClient.db("cloud_optimizer");
        usersCollection = db.collection("users");
        historyCollection = db.collection("history");
        instanceLimitsCollection = db.collection("instance_limits");
        awsCredentialsCollection = db.collection("aws_credentials");
        console.log("✅ MongoDB connected successfully. Initializing collections...");

        // Create indexes for better performance and data integrity
        await usersCollection.createIndex({ username: 1 }, { unique: true });
        await usersCollection.createIndex({ email: 1 }, { unique: true, sparse: true });
        await historyCollection.createIndex({ userId: 1, timestamp: -1 });
        await instanceLimitsCollection.createIndex({ userId: 1, instanceId: 1 }, { unique: true });
        await instanceLimitsCollection.createIndex({ userId: 1 });
        await awsCredentialsCollection.createIndex({ userId: 1 }, { unique: true });
        console.log("✅ Database indexes created.");
        
        // Check user count
        const userCount = await usersCollection.countDocuments();
        console.log(`✅ Current registered users: ${userCount}`);

    } catch (e) {
        console.error("❌ Could not connect to MongoDB:", e.message);
        console.error("⚠️  Please check your MONGO_URI in .env file");
        process.exit(1); // Exit if DB connection fails
    }
}

// --- Helper: Validate AWS Credentials ---
async function validateAWSCredentials(accessKey, secretKey) {
    try {
        console.log("🔐 Validating AWS credentials...");
        
        const credentials = {
            accessKeyId: accessKey,
            secretAccessKey: secretKey
        };

        // Use STS GetCallerIdentity to validate credentials
        // This is the lightest AWS API call to verify credentials
        const { STSClient, GetCallerIdentityCommand } = require('@aws-sdk/client-sts');
        const stsClient = new STSClient({ region: AWS_REGION, credentials });
        
        const command = new GetCallerIdentityCommand({});
        const response = await stsClient.send(command);
        
        console.log(`✅ AWS Credentials validated for account: ${response.Account}`);
        return { 
            valid: true, 
            accountId: response.Account,
            userId: response.UserId,
            arn: response.Arn
        };
        
    } catch (error) {
        console.error("❌ AWS Credential Validation Failed:", error.message);
        
        if (error.name === 'UnrecognizedClientException' || 
            error.name === 'InvalidClientTokenId' ||
            error.name === 'SignatureDoesNotMatch' ||
            error.message.includes('security token')) {
            return { 
                valid: false, 
                error: "Invalid AWS credentials. Please verify your Access Key ID and Secret Access Key are correct." 
            };
        }
        
        if (error.name === 'ExpiredToken') {
            return { 
                valid: false, 
                error: "AWS credentials have expired. Please generate new credentials." 
            };
        }
        
        return { 
            valid: false, 
            error: `AWS validation error: ${error.message}` 
        };
    }
}

// Get all AWS regions to search for resources
async function getAllActiveRegions(credentials) {
    try {
        const ec2Client = new EC2Client({ region: 'us-east-1', credentials });
        const { DescribeRegionsCommand } = require('@aws-sdk/client-ec2');
        const command = new DescribeRegionsCommand({ AllRegions: false });
        const response = await ec2Client.send(command);
        
        const regions = response.Regions.map(r => r.RegionName);
        console.log(`🌍 Found ${regions.length} active AWS regions`);
        return regions;
    } catch (error) {
        console.warn('⚠️ Could not fetch regions, using common ones:', error.message);
        // Return most common regions if API call fails
        return ['us-east-1', 'us-east-2', 'us-west-1', 'us-west-2', 'eu-west-1', 'ap-south-1'];
    }
}

// Fetch resources from all regions
async function fetchFromAllRegions(credentials, fetchFunction, serviceName) {
    const regions = await getAllActiveRegions(credentials);
    console.log(`\n🔍 Searching for ${serviceName} across all regions...`);
    
    const allResults = [];
    
    for (const region of regions) {
        try {
            console.log(`   Checking region: ${region}`);
            const result = await fetchFunction(region, credentials);
            if (result && (result.instances?.length > 0 || result.volumes?.length > 0 || result.functions?.length > 0 || result.total > 0)) {
                console.log(`   ✅ Found resources in ${region}`);
                allResults.push({ region, data: result });
            }
        } catch (error) {
            console.warn(`   ⚠️ Error in ${region}: ${error.message}`);
        }
    }
    
    return allResults;
}

// --- Helper: Comprehensive Real AWS Data Fetching ---
async function fetchRealAWSData(accessKey, secretKey) {
    try {
        console.log("🔄 Attempting to fetch comprehensive real-time AWS data...");
        console.log(`🌍 Primary Region: ${AWS_REGION}`);
        
        const credentials = {
            accessKeyId: accessKey,
            secretAccessKey: secretKey
        };

        // Try primary region first
        const ec2Client = new EC2Client({ 
            region: AWS_REGION, 
            credentials,
            maxAttempts: 3
        });
        const cloudWatchClient = new CloudWatchClient({ 
            region: AWS_REGION, 
            credentials,
            maxAttempts: 3
        });
        const costExplorerClient = new CostExplorerClient({ 
            region: 'us-east-1', // Cost Explorer only available in us-east-1
            credentials,
            maxAttempts: 3
        });
        const lambdaClient = new LambdaClient({ 
            region: AWS_REGION, 
            credentials,
            maxAttempts: 3
        });
        const rdsClient = new RDSClient({ 
            region: AWS_REGION, 
            credentials,
            maxAttempts: 3
        });

        console.log('📡 Starting data fetch from AWS APIs...\n');

        // First, try primary region
        let [ec2Data, volumesData, snapshotsData, lambdaData, rdsData, costData] = await Promise.allSettled([
            fetchEC2Data(ec2Client, cloudWatchClient),
            fetchEBSVolumes(ec2Client, cloudWatchClient),
            fetchSnapshots(ec2Client),
            fetchLambdaFunctions(lambdaClient, cloudWatchClient),
            fetchRDSInstances(rdsClient, cloudWatchClient),
            fetchCostData(costExplorerClient)
        ]);
        
        // Check if we found any resources in primary region
        const ec2Result = ec2Data.status === 'fulfilled' ? ec2Data.value : null;
        const hasEC2InPrimaryRegion = ec2Result && ec2Result.instances && ec2Result.instances.length > 0;
        
        if (!hasEC2InPrimaryRegion) {
            console.log(`\n⚠️  No EC2 instances found in ${AWS_REGION}`);
            console.log(`🔍 Searching all AWS regions for your resources...`);
            
            // Search all regions for EC2 instances
            const regions = await getAllActiveRegions(credentials);
            let foundInstances = false;
            
            for (const region of regions) {
                if (region === AWS_REGION) continue; // Already checked
                
                try {
                    console.log(`   Checking ${region}...`);
                    const regionalEC2 = new EC2Client({ region, credentials, maxAttempts: 2 });
                    const regionalCW = new CloudWatchClient({ region, credentials, maxAttempts: 2 });
                    
                    const regionalData = await fetchEC2Data(regionalEC2, regionalCW);
                    
                    if (regionalData.instances && regionalData.instances.length > 0) {
                        console.log(`   ✅ Found ${regionalData.instances.length} instances in ${region}!`);
                        ec2Data = { status: 'fulfilled', value: regionalData };
                        foundInstances = true;
                        
                        // Also fetch volumes and snapshots from this region
                        const regionalVolumes = await fetchEBSVolumes(regionalEC2, regionalCW);
                        const regionalSnapshots = await fetchSnapshots(regionalEC2);
                        
                        if (regionalVolumes.volumes && regionalVolumes.volumes.length > 0) {
                            volumesData = { status: 'fulfilled', value: regionalVolumes };
                        }
                        if (regionalSnapshots.total > 0) {
                            snapshotsData = { status: 'fulfilled', value: regionalSnapshots };
                        }
                        
                        console.log(`📍 Using region ${region} for analysis`);
                        break;
                    }
                } catch (error) {
                    console.warn(`   ⚠️ Error checking ${region}: ${error.message}`);
                }
            }
            
            if (!foundInstances) {
                console.log(`\n⚠️  No EC2 instances found in any region. This could mean:`);
                console.log(`   1. You have no running EC2 instances`);
                console.log(`   2. IAM permissions don't allow ec2:DescribeInstances`);
                console.log(`   3. Credentials are for a different AWS account`);
            }
        }

        // Process results with detailed error logging
        console.log('\n📋 Processing fetched data...');
        
        const instances = ec2Data.status === 'fulfilled' ? ec2Data.value : (() => {
            console.error('❌ EC2 data fetch failed:', ec2Data.reason?.message || 'Unknown error');
            return { instances: [], underutilized: [], metrics: {} };
        })();
        
        const volumes = volumesData.status === 'fulfilled' ? volumesData.value : (() => {
            console.error('❌ EBS volumes fetch failed:', volumesData.reason?.message || 'Unknown error');
            return { volumes: [], underutilized: [] };
        })();
        
        const snapshots = snapshotsData.status === 'fulfilled' ? snapshotsData.value : (() => {
            console.error('❌ Snapshots fetch failed:', snapshotsData.reason?.message || 'Unknown error');
            return { total: 0, oldSnapshots: [] };
        })();
        
        const lambda = lambdaData.status === 'fulfilled' ? lambdaData.value : (() => {
            console.error('❌ Lambda data fetch failed:', lambdaData.reason?.message || 'Unknown error');
            return { functions: [], underutilized: [] };
        })();
        
        const rds = rdsData.status === 'fulfilled' ? rdsData.value : (() => {
            console.error('❌ RDS data fetch failed:', rdsData.reason?.message || 'Unknown error');
            return { instances: [], underutilized: [] };
        })();
        
        const costs = costData.status === 'fulfilled' ? costData.value : (() => {
            console.error('❌ Cost data fetch failed:', costData.reason?.message || 'Unknown error');
            return { current: 0, forecast: 0, breakdown: {} };
        })();

        // Calculate savings opportunities from actual resource data
        const ec2Savings = instances.underutilized.reduce((sum, i) => sum + (i.estimatedSavings || 0), 0);
        const ebsSavings = volumes.underutilized.reduce((sum, v) => sum + (v.estimatedSavings || 0), 0);
        const snapshotSavings = snapshots.oldSnapshots.reduce((sum, s) => sum + (s.estimatedSavings || 0), 0);
        const lambdaSavings = lambda.underutilized.reduce((sum, l) => sum + (l.estimatedSavings || 0), 0);
        const rdsSavings = rds.underutilized.reduce((sum, r) => sum + (r.estimatedSavings || 0), 0);

        const savingsBreakdown = {
            ec2: parseFloat(ec2Savings.toFixed(2)),
            ebs: parseFloat(ebsSavings.toFixed(2)),
            snapshots: parseFloat(snapshotSavings.toFixed(2)),
            lambda: parseFloat(lambdaSavings.toFixed(2)),
            rds: parseFloat(rdsSavings.toFixed(2))
        };

        const totalSavings = ec2Savings + ebsSavings + snapshotSavings + lambdaSavings + rdsSavings;

        // Log comprehensive summary
        console.log('\n═══════════════════════════════════════════════════════');
        console.log('📊 AWS INFRASTRUCTURE SUMMARY');
        console.log('═══════════════════════════════════════════════════════');
        console.log(`💰 COSTS:`);
        console.log(`   Current Month: $${costs.current.toFixed(2)}`);
        console.log(`   Forecasted: $${costs.forecast.toFixed(2)}`);
        console.log(`\n🖥️  EC2 INSTANCES:`);
        console.log(`   Total: ${instances.instances.length}`);
        console.log(`   Running: ${instances.instances.filter(i => i.state === 'running').length}`);
        console.log(`   Stopped: ${instances.instances.filter(i => i.state === 'stopped').length}`);
        console.log(`   Underutilized: ${instances.underutilized.length} (Save $${ec2Savings.toFixed(2)}/mo)`);
        console.log(`\n💾 EBS VOLUMES:`);
        console.log(`   Total: ${volumes.volumes.length}`);
        console.log(`   Total Storage: ${volumes.volumes.reduce((sum, v) => sum + v.size, 0)} GB`);
        console.log(`   Attached: ${volumes.volumes.filter(v => v.state === 'in-use').length}`);
        console.log(`   Unattached: ${volumes.volumes.filter(v => v.state === 'available').length}`);
        console.log(`   Issues: ${volumes.underutilized.length} (Save $${ebsSavings.toFixed(2)}/mo)`);
        console.log(`\n📸 SNAPSHOTS:`);
        console.log(`   Total: ${snapshots.total}`);
        console.log(`   Old (>90 days): ${snapshots.oldSnapshots.length} (Save $${snapshotSavings.toFixed(2)}/mo)`);
        console.log(`\n⚡ LAMBDA FUNCTIONS:`);
        console.log(`   Total: ${lambda.functions.length}`);
        console.log(`   Issues: ${lambda.underutilized.length} (Save $${lambdaSavings.toFixed(2)}/mo)`);
        console.log(`\n🗄️  RDS INSTANCES:`);
        console.log(`   Total: ${rds.instances.length}`);
        console.log(`   Underutilized: ${rds.underutilized.length} (Save $${rdsSavings.toFixed(2)}/mo)`);
        console.log(`\n💵 TOTAL SAVINGS OPPORTUNITY: $${totalSavings.toFixed(2)}/month ($${(totalSavings * 12).toFixed(2)}/year)`);
        console.log('═══════════════════════════════════════════════════════\n');

        const awsData = {
            // Cost Overview
            totalMonthlyCost: costs.current.toFixed(2),
            forecastedCost: costs.forecast.toFixed(2),
            costBreakdown: costs.breakdown,
            savingsOpportunities: totalSavings.toFixed(2),
            savingsBreakdown,
            
            // EC2 Metrics
            totalInstances: instances.instances.length,
            runningInstances: instances.instances.filter(i => i.state === 'running').length,
            stoppedInstances: instances.instances.filter(i => i.state === 'stopped').length,
            underutilizedEC2: instances.underutilized,
            ec2Metrics: instances.metrics,
            ec2Details: instances.instances,
            
            // EBS Metrics
            totalVolumes: volumes.volumes.length,
            attachedVolumes: volumes.volumes.filter(v => v.state === 'in-use').length,
            unattachedVolumes: volumes.volumes.filter(v => v.state === 'available').length,
            underutilizedEBS: volumes.underutilized,
            totalStorageGB: volumes.volumes.reduce((sum, v) => sum + v.size, 0),
            volumeDetails: volumes.volumes,
            
            // Snapshot Metrics
            totalSnapshots: snapshots.total,
            oldSnapshots: snapshots.oldSnapshots,
            
            // Lambda Metrics
            totalLambdaFunctions: lambda.functions.length,
            underutilizedLambda: lambda.underutilized,
            lambdaDetails: lambda.functions,
            
            // RDS Metrics
            totalRDSInstances: rds.instances.length,
            underutilizedRDS: rds.underutilized,
            rdsDetails: rds.instances,
            
            // Metadata
            timestamp: new Date().toISOString(),
            region: AWS_REGION,
            dataQuality: 'real',
            dataSource: 'AWS API'
        };

        console.log("✅ Comprehensive real-time AWS data fetched successfully!");
        console.log('\n📤 Returning data to frontend:');
        console.log(`   - ${awsData.totalInstances} EC2 instances (${awsData.runningInstances} running)`);
        console.log(`   - ${awsData.underutilizedEC2.length} underutilized EC2`);
        console.log(`   - ${awsData.totalVolumes} EBS volumes`);
        console.log(`   - ${awsData.underutilizedEBS.length} underutilized EBS`);
        console.log(`   - ${awsData.totalSnapshots} snapshots`);
        console.log(`   - ${awsData.totalLambdaFunctions} Lambda functions`);
        console.log(`   - ${awsData.totalRDSInstances} RDS instances\n`);
        
        return { success: true, data: awsData };

    } catch (error) {
        console.error("❌ AWS API Error:", error.message);
        console.error("Stack trace:", error.stack);
        
        if (error.name === 'UnrecognizedClientException' || error.name === 'InvalidClientTokenId') {
            return { success: false, message: "Invalid AWS credentials. Please verify your Access Key and Secret Key." };
        }
        
        return { 
            success: false, 
            message: `AWS API Error: ${error.message}`,
            shouldFallback: true
        };
    }
}

// Fetch EC2 instances with CloudWatch metrics
async function fetchEC2Data(ec2Client, cloudWatchClient) {
    try {
        console.log('🔍 Fetching EC2 instances...');
        const ec2Command = new DescribeInstancesCommand({});
        const ec2Response = await ec2Client.send(ec2Command);
        
        const instances = [];
        const underutilized = [];
        const metrics = {};

        console.log(`📊 Found ${ec2Response.Reservations?.length || 0} EC2 reservations`);

        for (const reservation of ec2Response.Reservations || []) {
            for (const instance of reservation.Instances || []) {
                const instanceData = {
                    id: instance.InstanceId,
                    type: instance.InstanceType,
                    state: instance.State.Name,
                    launchTime: instance.LaunchTime,
                    az: instance.Placement?.AvailabilityZone,
                    platform: instance.Platform || 'Linux',
                    tags: instance.Tags?.reduce((acc, tag) => ({ ...acc, [tag.Key]: tag.Value }), {}) || {}
                };
                instances.push(instanceData);

                const instanceName = instance.Tags?.find(t => t.Key === 'Name')?.Value || 'Unnamed';
                console.log(`   Instance: ${instance.InstanceId} (${instance.InstanceType}) - ${instanceName} - State: ${instance.State.Name}`);

                // Fetch metrics for running instances
                if (instance.State.Name === 'running') {
                    try {
                        console.log(`      Fetching metrics for ${instance.InstanceId}...`);
                        
                        const [cpuMetrics, networkMetrics] = await Promise.all([
                            getCloudWatchMetric(cloudWatchClient, 'AWS/EC2', 'CPUUtilization', instance.InstanceId, 7),
                            getCloudWatchMetric(cloudWatchClient, 'AWS/EC2', 'NetworkIn', instance.InstanceId, 7)
                        ]);

                        metrics[instance.InstanceId] = {
                            cpu: cpuMetrics,
                            network: networkMetrics
                        };

                        console.log(`      ├─ CPU: ${cpuMetrics.average.toFixed(2)}% (avg), ${cpuMetrics.maximum.toFixed(2)}% (max) [${cpuMetrics.datapoints} datapoints]`);
                        console.log(`      └─ Network In: ${(networkMetrics.average / 1024 / 1024).toFixed(2)} MB [${networkMetrics.datapoints} datapoints]`);

                        // Identify underutilized instances (low CPU usage)
                        // Be more lenient - only flag if both avg AND max are low
                        if (cpuMetrics.datapoints > 0) {
                            if (cpuMetrics.average < 10 && cpuMetrics.maximum < 30) {
                                underutilized.push({
                                    id: instance.InstanceId,
                                    type: instance.InstanceType,
                                    name: instanceName,
                                    cpuAvg: `${cpuMetrics.average.toFixed(2)}%`,
                                    cpuMax: `${cpuMetrics.maximum.toFixed(2)}%`,
                                    networkIn: `${(networkMetrics.average / 1024 / 1024).toFixed(2)} MB`,
                                    reason: `CPU utilization is ${cpuMetrics.average.toFixed(1)}% (avg) and ${cpuMetrics.maximum.toFixed(1)}% (max) over the last 7 days. Instance is underutilized.`,
                                    estimatedSavings: estimateEC2Savings(instance.InstanceType),
                                    recommendation: `Downsize to ${suggestInstanceType(instance.InstanceType, cpuMetrics.average)}`
                                });
                                console.log(`      ⚠️  UNDERUTILIZED - Added to recommendations`);
                            } else {
                                console.log(`      ✅ Properly utilized`);
                            }
                        } else {
                            console.log(`      ⚠️  No CloudWatch metrics available yet (instance may be newly launched)`);
                        }
                    } catch (metricsError) {
                        console.warn(`      ❌ Could not fetch metrics for ${instance.InstanceId}: ${metricsError.message}`);
                    }
                } else if (instance.State.Name === 'stopped') {
                    // Stopped instances are also candidates for termination
                    underutilized.push({
                        id: instance.InstanceId,
                        type: instance.InstanceType,
                        name: instanceName,
                        cpuAvg: 'N/A (Stopped)',
                        cpuMax: 'N/A (Stopped)',
                        networkIn: 'N/A',
                        reason: `Instance is in stopped state. You're still paying for attached EBS volumes. Consider terminating if not needed.`,
                        estimatedSavings: 15,
                        recommendation: 'Terminate if no longer needed, or start instance if still required'
                    });
                    console.log(`      ⚠️  STOPPED - Consider terminating`);
                }
            }
        }

        console.log(`✅ EC2 Summary: ${instances.length} total, ${underutilized.length} underutilized`);
        return { instances, underutilized, metrics };
        
    } catch (error) {
        console.error('❌ EC2 fetch error:', error.message);
        return { instances: [], underutilized: [], metrics: {} };
    }
}

// Estimate EC2 savings based on instance type
function estimateEC2Savings(instanceType) {
    const pricing = {
        't2.micro': 8,
        't2.small': 17,
        't2.medium': 34,
        't2.large': 68,
        't3.micro': 8,
        't3.small': 15,
        't3.medium': 30,
        't3.large': 60,
        'm5.large': 70,
        'm5.xlarge': 140,
        'm5.2xlarge': 280,
        'c5.large': 62,
        'c5.xlarge': 124,
        'r5.large': 92,
        'r5.xlarge': 184
    };
    
    return pricing[instanceType] || 35;
}

// Fetch EBS volumes with metrics
async function fetchEBSVolumes(ec2Client, cloudWatchClient) {
    try {
        console.log('💾 Fetching EBS volumes...');
        const volumesCommand = new DescribeVolumesCommand({});
        const volumesResponse = await ec2Client.send(volumesCommand);
        
        const volumes = [];
        const underutilized = [];

        console.log(`📊 Found ${volumesResponse.Volumes?.length || 0} EBS volumes`);

        for (const volume of volumesResponse.Volumes || []) {
            const volumeData = {
                id: volume.VolumeId,
                size: volume.Size,
                type: volume.VolumeType,
                state: volume.State,
                iops: volume.Iops,
                encrypted: volume.Encrypted,
                attachments: volume.Attachments.length,
                createTime: volume.CreateTime
            };
            volumes.push(volumeData);

            console.log(`   Volume: ${volume.VolumeId} (${volume.Size}GB ${volume.VolumeType}) - State: ${volume.State}`);

            // Identify unattached volumes
            if (volume.State === 'available') {
                const monthlyCost = (volume.Size * 0.10).toFixed(2);
                underutilized.push({
                    id: volume.VolumeId,
                    size: `${volume.Size}GB`,
                    type: volume.VolumeType,
                    usage: '0% (Unattached)',
                    reason: 'Volume is not attached to any instance. Consider creating a snapshot and deleting to save costs.',
                    estimatedSavings: parseFloat(monthlyCost),
                    recommendation: 'Create snapshot then delete volume'
                });
                console.log(`   ⚠️  UNATTACHED - Wasting $${monthlyCost}/month`);
            }

            // Check IOPS utilization for provisioned IOPS volumes
            if (volume.VolumeType.includes('io') && volume.State === 'in-use') {
                try {
                    const [readOps, writeOps] = await Promise.all([
                        getCloudWatchMetric(cloudWatchClient, 'AWS/EBS', 'VolumeReadOps', volume.VolumeId, 7, 'VolumeId'),
                        getCloudWatchMetric(cloudWatchClient, 'AWS/EBS', 'VolumeWriteOps', volume.VolumeId, 7, 'VolumeId')
                    ]);
                    
                    const avgIops = (readOps.average + writeOps.average) / 2;
                    const utilizationPct = (avgIops / volume.Iops) * 100;
                    
                    console.log(`   ├─ Provisioned IOPS: ${volume.Iops}`);
                    console.log(`   └─ Actual IOPS usage: ${avgIops.toFixed(0)} (${utilizationPct.toFixed(1)}%)`);
                    
                    if (utilizationPct < 20) {
                        underutilized.push({
                            id: volume.VolumeId,
                            size: `${volume.Size}GB`,
                            type: volume.VolumeType,
                            usage: `${utilizationPct.toFixed(1)}%`,
                            reason: `Provisioned IOPS (${volume.Iops}) but using only ${avgIops.toFixed(0)} IOPS on average (${utilizationPct.toFixed(1)}% utilization).`,
                            estimatedSavings: 25,
                            recommendation: 'Convert to gp3 for better cost efficiency'
                        });
                        console.log(`   ⚠️  OVER-PROVISIONED - Could save $25/month`);
                    }
                } catch (e) {
                    console.warn(`   ⚠️ Could not fetch IOPS metrics for ${volume.VolumeId}: ${e.message}`);
                }
            }

            // Check for old gp2 volumes that should be gp3
            if (volume.VolumeType === 'gp2' && volume.State === 'in-use') {
                const potentialSavings = (volume.Size * 0.02).toFixed(2);
                if (parseFloat(potentialSavings) > 1) {
                    underutilized.push({
                        id: volume.VolumeId,
                        size: `${volume.Size}GB`,
                        type: volume.VolumeType,
                        usage: 'N/A',
                        reason: 'Using older gp2 volume type. gp3 offers better performance at 20% lower cost.',
                        estimatedSavings: parseFloat(potentialSavings),
                        recommendation: 'Convert to gp3 volume type'
                    });
                }
            }
        }

        console.log(`✅ EBS Summary: ${volumes.length} total, ${underutilized.length} optimization opportunities`);
        return { volumes, underutilized };
        
    } catch (error) {
        console.error('❌ EBS fetch error:', error.message);
        return { volumes: [], underutilized: [] };
    }
}

// Fetch old snapshots
async function fetchSnapshots(ec2Client) {
    try {
        console.log('📸 Fetching EBS snapshots...');
        const snapshotsCommand = new DescribeSnapshotsCommand({ OwnerIds: ['self'] });
        const snapshotsResponse = await ec2Client.send(snapshotsCommand);
        
        const oldSnapshots = [];
        const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
        const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

        console.log(`📊 Found ${snapshotsResponse.Snapshots?.length || 0} snapshots`);

        for (const snapshot of snapshotsResponse.Snapshots || []) {
            const ageInDays = Math.floor((Date.now() - new Date(snapshot.StartTime)) / (1000 * 60 * 60 * 24));
            
            // Flag snapshots older than 90 days
            if (new Date(snapshot.StartTime) < ninetyDaysAgo) {
                const monthlyCost = (snapshot.VolumeSize * 0.05).toFixed(2);
                oldSnapshots.push({
                    id: snapshot.SnapshotId,
                    size: `${snapshot.VolumeSize}GB`,
                    age: ageInDays,
                    created: snapshot.StartTime,
                    description: snapshot.Description || 'No description',
                    reason: `Snapshot is ${ageInDays} days old (>90 days). Review if still needed.`,
                    estimatedSavings: parseFloat(monthlyCost)
                });
                console.log(`   ⚠️  Old snapshot: ${snapshot.SnapshotId} (${ageInDays} days old, ${snapshot.VolumeSize}GB)`);
            }
        }

        console.log(`✅ Snapshot Summary: ${snapshotsResponse.Snapshots?.length || 0} total, ${oldSnapshots.length} old snapshots`);
        return { total: snapshotsResponse.Snapshots?.length || 0, oldSnapshots };
        
    } catch (error) {
        console.error('❌ Snapshot fetch error:', error.message);
        return { total: 0, oldSnapshots: [] };
    }
}

// Fetch Lambda functions
async function fetchLambdaFunctions(lambdaClient, cloudWatchClient) {
    try {
        console.log('⚡ Fetching Lambda functions...');
        const functionsCommand = new ListFunctionsCommand({});
        const functionsResponse = await lambdaClient.send(functionsCommand);
        
        const functions = functionsResponse.Functions || [];
        const underutilized = [];

        console.log(`📊 Found ${functions.length} Lambda functions`);

        // Check all functions, not just first 10
        for (const func of functions) {
            try {
                console.log(`   Function: ${func.FunctionName} (${func.Runtime})`);
                
                const [invocations, errors, duration] = await Promise.all([
                    getCloudWatchMetric(cloudWatchClient, 'AWS/Lambda', 'Invocations', func.FunctionName, 30, 'FunctionName'),
                    getCloudWatchMetric(cloudWatchClient, 'AWS/Lambda', 'Errors', func.FunctionName, 30, 'FunctionName'),
                    getCloudWatchMetric(cloudWatchClient, 'AWS/Lambda', 'Duration', func.FunctionName, 30, 'FunctionName')
                ]);
                
                console.log(`   ├─ Invocations (30d): ${invocations.sum}`);
                console.log(`   ├─ Errors: ${errors.sum}`);
                console.log(`   └─ Avg Duration: ${duration.average.toFixed(0)}ms`);
                
                // Flag functions with very low invocations
                if (invocations.sum < 10) {
                    underutilized.push({
                        name: func.FunctionName,
                        runtime: func.Runtime,
                        memory: func.MemorySize,
                        invocations: Math.floor(invocations.sum),
                        errors: Math.floor(errors.sum),
                        avgDuration: `${duration.average.toFixed(0)}ms`,
                        reason: `Only ${Math.floor(invocations.sum)} invocations in the last 30 days. Function may be unused or redundant.`,
                        estimatedSavings: 5,
                        recommendation: 'Review and consider removing if no longer needed'
                    });
                    console.log(`   ⚠️  UNDERUTILIZED - Very low usage`);
                }
                
                // Flag functions with high error rates
                if (invocations.sum > 0 && (errors.sum / invocations.sum) > 0.1) {
                    const errorRate = ((errors.sum / invocations.sum) * 100).toFixed(1);
                    if (!underutilized.find(u => u.name === func.FunctionName)) {
                        underutilized.push({
                            name: func.FunctionName,
                            runtime: func.Runtime,
                            memory: func.MemorySize,
                            invocations: Math.floor(invocations.sum),
                            errors: Math.floor(errors.sum),
                            avgDuration: `${duration.average.toFixed(0)}ms`,
                            reason: `High error rate: ${errorRate}% (${Math.floor(errors.sum)} errors out of ${Math.floor(invocations.sum)} invocations)`,
                            estimatedSavings: 3,
                            recommendation: 'Review logs and fix errors to reduce wasted compute'
                        });
                        console.log(`   ⚠️  HIGH ERROR RATE - ${errorRate}%`);
                    }
                }
                
            } catch (e) {
                console.warn(`   ⚠️ Could not fetch metrics for Lambda ${func.FunctionName}: ${e.message}`);
            }
        }

        console.log(`✅ Lambda Summary: ${functions.length} total, ${underutilized.length} optimization opportunities`);
        return { functions, underutilized };
        
    } catch (error) {
        console.error('❌ Lambda fetch error:', error.message);
        return { functions: [], underutilized: [] };
    }
}

// Fetch RDS instances
async function fetchRDSInstances(rdsClient, cloudWatchClient) {
    try {
        console.log('🗄️  Fetching RDS instances...');
        const rdsCommand = new DescribeDBInstancesCommand({});
        const rdsResponse = await rdsClient.send(rdsCommand);
        
        const instances = rdsResponse.DBInstances || [];
        const underutilized = [];

        console.log(`📊 Found ${instances.length} RDS instances`);

        for (const db of instances) {
            try {
                console.log(`   RDS: ${db.DBInstanceIdentifier} (${db.DBInstanceClass} ${db.Engine})`);
                
                const [cpuMetrics, connections, readIOPS, writeIOPS] = await Promise.all([
                    getCloudWatchMetric(cloudWatchClient, 'AWS/RDS', 'CPUUtilization', db.DBInstanceIdentifier, 7, 'DBInstanceIdentifier'),
                    getCloudWatchMetric(cloudWatchClient, 'AWS/RDS', 'DatabaseConnections', db.DBInstanceIdentifier, 7, 'DBInstanceIdentifier'),
                    getCloudWatchMetric(cloudWatchClient, 'AWS/RDS', 'ReadIOPS', db.DBInstanceIdentifier, 7, 'DBInstanceIdentifier'),
                    getCloudWatchMetric(cloudWatchClient, 'AWS/RDS', 'WriteIOPS', db.DBInstanceIdentifier, 7, 'DBInstanceIdentifier')
                ]);
                
                console.log(`   ├─ CPU: ${cpuMetrics.average.toFixed(2)}% (avg), ${cpuMetrics.maximum.toFixed(2)}% (max)`);
                console.log(`   ├─ Connections: ${connections.average.toFixed(0)} (avg), ${connections.maximum.toFixed(0)} (max)`);
                console.log(`   └─ IOPS: Read ${readIOPS.average.toFixed(0)}, Write ${writeIOPS.average.toFixed(0)}`);
                
                // Flag underutilized instances
                if (cpuMetrics.average < 20 && connections.average < 5) {
                    underutilized.push({
                        id: db.DBInstanceIdentifier,
                        type: db.DBInstanceClass,
                        engine: `${db.Engine} ${db.EngineVersion}`,
                        storage: `${db.AllocatedStorage}GB`,
                        multiAZ: db.MultiAZ,
                        cpuAvg: `${cpuMetrics.average.toFixed(2)}%`,
                        cpuMax: `${cpuMetrics.maximum.toFixed(2)}%`,
                        connections: connections.average.toFixed(0),
                        maxConnections: connections.maximum.toFixed(0),
                        reason: `Low CPU utilization (${cpuMetrics.average.toFixed(1)}% avg) and minimal connections (${connections.average.toFixed(0)} avg). Database is over-provisioned.`,
                        estimatedSavings: estimateRDSSavings(db.DBInstanceClass, db.MultiAZ),
                        recommendation: `Downsize to ${suggestRDSInstanceType(db.DBInstanceClass, cpuMetrics.average)}`
                    });
                    console.log(`   ⚠️  UNDERUTILIZED - Could save $${estimateRDSSavings(db.DBInstanceClass, db.MultiAZ)}/month`);
                }
                
                // Flag instances with very low connections
                if (connections.maximum < 2 && instances.length > 0) {
                    if (!underutilized.find(u => u.id === db.DBInstanceIdentifier)) {
                        underutilized.push({
                            id: db.DBInstanceIdentifier,
                            type: db.DBInstanceClass,
                            engine: `${db.Engine} ${db.EngineVersion}`,
                            storage: `${db.AllocatedStorage}GB`,
                            multiAZ: db.MultiAZ,
                            cpuAvg: `${cpuMetrics.average.toFixed(2)}%`,
                            cpuMax: `${cpuMetrics.maximum.toFixed(2)}%`,
                            connections: connections.average.toFixed(0),
                            maxConnections: connections.maximum.toFixed(0),
                            reason: `Maximum of ${connections.maximum} connections in 7 days. Database appears unused or for development only.`,
                            estimatedSavings: estimateRDSSavings(db.DBInstanceClass, db.MultiAZ),
                            recommendation: 'Consider stopping or moving to smaller instance for dev/test workloads'
                        });
                    }
                }
                
            } catch (e) {
                console.warn(`   ⚠️ Could not fetch metrics for RDS ${db.DBInstanceIdentifier}: ${e.message}`);
            }
        }

        console.log(`✅ RDS Summary: ${instances.length} total, ${underutilized.length} optimization opportunities`);
        return { instances, underutilized };
        
    } catch (error) {
        console.error('❌ RDS fetch error:', error.message);
        return { instances: [], underutilized: [] };
    }
}

// Estimate RDS savings based on instance class
function estimateRDSSavings(instanceClass, multiAZ) {
    const pricing = {
        'db.t3.micro': 15,
        'db.t3.small': 30,
        'db.t3.medium': 60,
        'db.t3.large': 120,
        'db.t4g.micro': 13,
        'db.t4g.small': 26,
        'db.t4g.medium': 52,
        'db.m5.large': 140,
        'db.m5.xlarge': 280,
        'db.m5.2xlarge': 560,
        'db.r5.large': 180,
        'db.r5.xlarge': 360
    };
    
    const baseSavings = pricing[instanceClass] || 50;
    return multiAZ ? baseSavings * 2 : baseSavings;
}

// Suggest appropriate RDS instance type
function suggestRDSInstanceType(currentType, cpuUsage) {
    const sizeMap = { 'micro': 0, 'small': 1, 'medium': 2, 'large': 3, 'xlarge': 4, '2xlarge': 5, '4xlarge': 6 };
    const parts = currentType.split('.');
    
    if (parts.length < 3) return currentType;
    
    const prefix = parts[0];
    const family = parts[1];
    const currentSize = parts[2];
    const currentIndex = sizeMap[currentSize] || 2;
    
    if (cpuUsage < 10) {
        const newIndex = Math.max(0, currentIndex - 2);
        const newSize = Object.keys(sizeMap).find(key => sizeMap[key] === newIndex);
        return `${prefix}.${family}.${newSize}`;
    } else if (cpuUsage < 20) {
        const newIndex = Math.max(0, currentIndex - 1);
        const newSize = Object.keys(sizeMap).find(key => sizeMap[key] === newIndex);
        return `${prefix}.${family}.${newSize}`;
    }
    
    return currentType;
}

// Fetch cost data with historical trends
async function fetchCostData(costExplorerClient) {
    try {
        console.log('💰 Fetching cost data from AWS Cost Explorer...');
        
        const today = new Date();
        const firstDayOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);
        const lastDayOfMonth = new Date(today.getFullYear(), today.getMonth() + 1, 0);
        
        const startDateStr = firstDayOfMonth.toISOString().split('T')[0];
        const endDateStr = today.toISOString().split('T')[0];

        console.log(`   Period: ${startDateStr} to ${endDateStr}`);

        // Current month cost with service breakdown
        const costCommand = new GetCostAndUsageCommand({
            TimePeriod: { Start: startDateStr, End: endDateStr },
            Granularity: 'MONTHLY',
            Metrics: ['UnblendedCost', 'UsageQuantity'],
            GroupBy: [{ Type: 'DIMENSION', Key: 'SERVICE' }]
        });

        const costResponse = await costExplorerClient.send(costCommand);
        let current = 0;
        const breakdown = {};

        if (costResponse.ResultsByTime && costResponse.ResultsByTime.length > 0) {
            const result = costResponse.ResultsByTime[0];
            current = parseFloat(result.Total?.UnblendedCost?.Amount || 0);
            
            console.log(`   ✅ Current month-to-date cost: $${current.toFixed(2)}`);
            
            result.Groups?.forEach(group => {
                const service = group.Keys[0].replace('Amazon ', '').replace('AWS ', '');
                const cost = parseFloat(group.Metrics.UnblendedCost.Amount);
                if (cost > 0.01) {
                    breakdown[service] = cost.toFixed(2);
                    console.log(`      ├─ ${service}: $${cost.toFixed(2)}`);
                }
            });
        }

        // If current cost is 0, try to get last month's cost as reference
        if (current === 0) {
            console.log('   ⚠️  No costs for current month yet, checking last month...');
            const lastMonthStart = new Date(today.getFullYear(), today.getMonth() - 1, 1).toISOString().split('T')[0];
            const lastMonthEnd = new Date(today.getFullYear(), today.getMonth(), 0).toISOString().split('T')[0];
            
            const lastMonthCommand = new GetCostAndUsageCommand({
                TimePeriod: { Start: lastMonthStart, End: lastMonthEnd },
                Granularity: 'MONTHLY',
                Metrics: ['UnblendedCost'],
                GroupBy: [{ Type: 'DIMENSION', Key: 'SERVICE' }]
            });
            
            const lastMonthResponse = await costExplorerClient.send(lastMonthCommand);
            if (lastMonthResponse.ResultsByTime && lastMonthResponse.ResultsByTime.length > 0) {
                const result = lastMonthResponse.ResultsByTime[0];
                current = parseFloat(result.Total?.UnblendedCost?.Amount || 0);
                console.log(`   ℹ️  Last month cost: $${current.toFixed(2)}`);
                
                result.Groups?.forEach(group => {
                    const service = group.Keys[0].replace('Amazon ', '').replace('AWS ', '');
                    const cost = parseFloat(group.Metrics.UnblendedCost.Amount);
                    if (cost > 0.01) {
                        breakdown[service] = cost.toFixed(2);
                    }
                });
            }
        }

        // Forecast next month
        let forecast = current * 1.05; // Default estimate (5% growth)
        try {
            const forecastStart = today.toISOString().split('T')[0];
            const forecastEnd = new Date(today.getFullYear(), today.getMonth() + 2, 0).toISOString().split('T')[0];
            
            const forecastCommand = new GetCostForecastCommand({
                TimePeriod: { Start: forecastStart, End: forecastEnd },
                Metric: 'UNBLENDED_COST',
                Granularity: 'MONTHLY'
            });

            const forecastResponse = await costExplorerClient.send(forecastCommand);
            forecast = parseFloat(forecastResponse.Total?.Amount || forecast);
            console.log(`   📈 Forecasted next month: $${forecast.toFixed(2)}`);
        } catch (e) {
            console.warn(`   ⚠️  Cost forecast unavailable: ${e.message}`);
            console.log(`   ℹ️  Using estimate: $${forecast.toFixed(2)}`);
        }

        console.log(`✅ Cost Summary: Current $${current.toFixed(2)}, Forecast $${forecast.toFixed(2)}`);

        return { current, forecast, breakdown };
        
    } catch (error) {
        console.error('❌ Cost Explorer Error:', error.message);
        
        if (error.name === 'AccessDeniedException') {
            console.error('   ℹ️  Cost Explorer access denied. Make sure:');
            console.error('      1. Cost Explorer is enabled in AWS Console');
            console.error('      2. IAM user has "ce:GetCostAndUsage" and "ce:GetCostForecast" permissions');
        }
        
        console.warn('   ⚠️  Returning zero costs - enable Cost Explorer for accurate billing data');
        return { current: 0, forecast: 0, breakdown: {} };
    }
}

// Generic CloudWatch metric fetcher with better error handling
async function getCloudWatchMetric(client, namespace, metricName, resourceId, days, dimensionName = 'InstanceId') {
    try {
        const endTime = new Date();
        const startTime = new Date(endTime.getTime() - days * 24 * 60 * 60 * 1000);
        
        const command = new GetMetricStatisticsCommand({
            Namespace: namespace,
            MetricName: metricName,
            Dimensions: [{ Name: dimensionName, Value: resourceId }],
            StartTime: startTime,
            EndTime: endTime,
            Period: 3600, // 1 hour intervals
            Statistics: ['Average', 'Maximum', 'Sum', 'Minimum']
        });

        const response = await client.send(command);
        const datapoints = response.Datapoints || [];
        
        if (datapoints.length === 0) {
            // No data available - might be a new resource or metrics not enabled
            return { average: 0, maximum: 0, minimum: 0, sum: 0, datapoints: 0 };
        }

        // Calculate statistics from datapoints
        const values = datapoints.map(dp => dp.Average || 0).filter(v => v !== null);
        const maxValues = datapoints.map(dp => dp.Maximum || 0).filter(v => v !== null);
        const minValues = datapoints.map(dp => dp.Minimum || 0).filter(v => v !== null);
        
        const average = values.length > 0 ? values.reduce((sum, val) => sum + val, 0) / values.length : 0;
        const maximum = maxValues.length > 0 ? Math.max(...maxValues) : 0;
        const minimum = minValues.length > 0 ? Math.min(...minValues) : 0;
        const sum = datapoints.reduce((s, dp) => s + (dp.Sum || 0), 0);

        return { 
            average, 
            maximum, 
            minimum, 
            sum, 
            datapoints: datapoints.length 
        };
        
    } catch (error) {
        // Don't treat missing metrics as errors for display purposes
        if (error.message.includes('No metrics found') || error.message.includes('not found')) {
            return { average: 0, maximum: 0, minimum: 0, sum: 0, datapoints: 0 };
        }
        console.warn(`⚠️ CloudWatch metric fetch failed for ${resourceId} (${metricName}): ${error.message}`);
        return { average: 0, maximum: 0, minimum: 0, sum: 0, datapoints: 0 };
    }
}

// Suggest appropriate instance type based on CPU usage
function suggestInstanceType(currentType, cpuUsage) {
    const sizeMap = { 'nano': 0, 'micro': 1, 'small': 2, 'medium': 3, 'large': 4, 'xlarge': 5, '2xlarge': 6 };
    const parts = currentType.split('.');
    
    if (parts.length < 2) return currentType;
    
    const family = parts[0];
    const currentSize = parts[1];
    const currentIndex = sizeMap[currentSize] || 3;
    
    if (cpuUsage < 5) {
        const newIndex = Math.max(0, currentIndex - 2);
        const newSize = Object.keys(sizeMap).find(key => sizeMap[key] === newIndex);
        return `${family}.${newSize}`;
    } else if (cpuUsage < 10) {
        const newIndex = Math.max(0, currentIndex - 1);
        const newSize = Object.keys(sizeMap).find(key => sizeMap[key] === newIndex);
        return `${family}.${newSize}`;
    }
    
    return currentType;
}

// --- Helper: Gemini API Call for Advice ---
async function getGeminiAdvice(currentData, historyData) {
    if (!genAI) {
        console.warn("⚠️ Gemini AI not initialized");
        return generateFallbackAdvice(currentData);
    }

    const historyString = historyData.map(d => 
        `[${new Date(d.timestamp).toLocaleDateString()}] Cost: $${d.totalMonthlyCost}, Underutilized EC2: ${d.underutilizedEC2?.length || 0}, EBS: ${d.underutilizedEBS?.length || 0}`
    ).join('\n');
    
    const currentTimestamp = new Date().toLocaleString();
    const analysisId = Math.floor(Math.random() * 100000);

    const prompt = `You are an AWS Cloud Cost Optimization expert. Provide actionable advice in EXACTLY 150-200 words.

📊 DATA: Monthly Cost: $${currentData.totalMonthlyCost} | Instances: ${currentData.totalInstances || 0} | Savings: $${currentData.savingsOpportunities}/mo
⚠️ Issues: ${currentData.underutilizedEC2?.length || 0} EC2, ${currentData.underutilizedEBS?.length || 0} EBS underutilized

Provide response in this EXACT markdown format:

## 🚨 Critical Issues

[Write 1-2 complete sentences. Put full sentences or phrases in bold on their own line if needed.]

## ⚡ Quick Wins

1. Action one with specific details
2. Action two with resource IDs
3. Action three with recommendations

## 📈 Long-term Strategy

- Strategy point one
- Strategy point two
- Strategy point three

## 💰 Savings Impact

Monthly savings: $[amount]
Annual savings: $[amount]

**STRICT RULES:**
- EXACTLY 150-200 words total
- Use ## for headers with blank line after
- Use numbered lists (1. 2. 3.) and bullet lists (-)
- Put bold text on separate lines or at start of sentences
- NO bold in middle of sentences like "text **bold** text"
- Use backticks for resource IDs like \`i-1234\`
- Keep paragraphs clean and readable`;

    try {
        console.log("🤖 Generating AI optimization advice...");
        const text = await generateWithGemini(prompt);
        console.log(`📝 AI Response Preview: ${text.substring(0, 150)}...`);
        return text;
    } catch (error) {
        console.error("❌ Gemini API call failed:", error.message);
        return generateFallbackAdvice(currentData);
    }
}

// Generate fallback advice when Gemini is unavailable
function generateFallbackAdvice(currentData) {
    const ec2Savings = currentData.underutilizedEC2?.reduce((sum, i) => sum + (i.estimatedSavings || 35), 0) || 0;
    const ebsSavings = currentData.underutilizedEBS?.reduce((sum, v) => sum + (v.estimatedSavings || 15), 0) || 0;
    const totalSavings = currentData.savingsOpportunities || 0;
    const ec2Count = currentData.underutilizedEC2?.length || 0;
    const ebsCount = currentData.underutilizedEBS?.length || 0;
    const snapshotCount = currentData.oldSnapshots?.length || 0;
    
    return `## 🚨 Critical Issues

${ec2Count > 0 ? `Your infrastructure has ${ec2Count} EC2 instances with less than 10% CPU utilization. Over-provisioned compute resources are costing $${ec2Savings} per month in wasted spend.` : 'All EC2 instances are properly utilized with healthy resource consumption patterns.'}

## ⚡ Quick Wins

1. ${ec2Count > 0 ? `Downsize or stop instance \`${currentData.underutilizedEC2[0]?.id}\` currently at ${currentData.underutilizedEC2[0]?.cpuAvg} CPU usage` : 'Review and terminate stopped instances older than 30 days'}
2. ${ebsCount > 0 ? `Delete ${ebsCount} unattached EBS volumes to save $${ebsSavings} monthly` : 'Implement EBS snapshot lifecycle management policies'}
3. ${snapshotCount > 0 ? `Clean up ${snapshotCount} snapshots older than 90 days for additional savings` : 'Enable auto-scaling groups for variable workload patterns'}

## 📈 Long-term Strategy

- Purchase Reserved Instances for predictable workloads to save up to 72%
- Implement auto-scaling to dynamically adjust capacity based on demand
- Use cost allocation tags for granular spending visibility across teams
- Schedule quarterly right-sizing reviews using CloudWatch metrics

## 💰 Savings Impact

Monthly savings: $${totalSavings}
Annual savings: $${totalSavings * 12}

---

*Configure GEMINI_API_KEY for enhanced AI recommendations*`;
}

// --- Middleware: JWT Authentication ---
function authenticateToken(req, res, next) {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) {
        return res.status(401).json({ success: false, message: 'Access token required' });
    }

    jwt.verify(token, JWT_SECRET, (err, user) => {
        if (err) {
            return res.status(403).json({ success: false, message: 'Invalid or expired token' });
        }
        req.user = user;
        next();
    });
}

// --- API Routes ---

// 1. Login Route
app.post('/api/login', async (req, res) => {
    const { username, password } = req.body;
    
    if (!username || !password) {
        return res.status(400).json({ success: false, message: "Username and password required" });
    }

    try {
        const user = await usersCollection.findOne({ username });
        
        if (!user) {
            return res.status(401).json({ success: false, message: "Invalid username or password" });
        }

        // Compare password with hash
        const isPasswordValid = await bcrypt.compare(password, user.password);
        
        if (!isPasswordValid) {
            return res.status(401).json({ success: false, message: "Invalid username or password" });
        }

        // Generate JWT token
        const token = jwt.sign(
            { 
                userId: user._id, 
                username: user.username 
            },
            JWT_SECRET,
            { expiresIn: '24h' }
        );

        console.log(`✅ User ${username} logged in successfully`);
        res.json({ 
            success: true, 
            message: "Login successful", 
            token,
            username: user.username
        });

    } catch (e) {
        console.error("❌ Login error:", e);
        res.status(500).json({ success: false, message: "Server error during login." });
    }
});

// 2. Register Route (Optional - for creating new users)
app.post('/api/register', async (req, res) => {
    const { username, password, email } = req.body;
    
    if (!username || !password) {
        return res.status(400).json({ success: false, error: "Username and password required" });
    }

    // Validate username
    if (username.length < 3 || username.length > 20) {
        return res.status(400).json({ success: false, error: "Username must be between 3 and 20 characters" });
    }

    if (!/^[a-zA-Z0-9_]+$/.test(username)) {
        return res.status(400).json({ success: false, error: "Username can only contain letters, numbers, and underscores" });
    }

    // Validate password
    if (password.length < 6) {
        return res.status(400).json({ success: false, error: "Password must be at least 6 characters" });
    }

    if (password.length > 100) {
        return res.status(400).json({ success: false, error: "Password is too long" });
    }

    try {
        // Check if username already exists
        const existingUser = await usersCollection.findOne({ username });
        if (existingUser) {
            return res.status(409).json({ success: false, error: "Username already exists" });
        }

        // Check if email already exists (if provided)
        if (email) {
            const existingEmail = await usersCollection.findOne({ email });
            if (existingEmail) {
                return res.status(409).json({ success: false, error: "Email already registered" });
            }
        }

        // Hash password
        const hashedPassword = await bcrypt.hash(password, 10);
        
        // Create new user
        const userDoc = {
            username,
            password: hashedPassword,
            createdAt: new Date()
        };

        if (email) {
            userDoc.email = email;
        }

        const result = await usersCollection.insertOne(userDoc);

        console.log(`✅ New user registered: ${username}${email ? ' (' + email + ')' : ''}`);
        res.json({ 
            success: true, 
            message: "Registration successful. Please login.",
            userId: result.insertedId
        });

    } catch (e) {
        console.error("❌ Registration error:", e);
        res.status(500).json({ success: false, message: "Server error during registration." });
    }
});

// 2a. Get User's AWS Credentials
app.get('/api/aws-credentials', authenticateToken, async (req, res) => {
    const userId = req.user.userId.toString();
    
    try {
        const credentials = await awsCredentialsCollection.findOne({ userId });
        
        if (credentials) {
            res.json({
                success: true,
                awsAccessKey: credentials.awsAccessKey,
                accountId: credentials.accountId || null
            });
        } else {
            res.json({
                success: true,
                awsAccessKey: null
            });
        }
    } catch (error) {
        console.error("❌ Error fetching AWS credentials:", error);
        res.status(500).json({
            success: false,
            message: "Failed to retrieve credentials"
        });
    }
});

// 2b. Delete User's AWS Credentials (for logout)
app.delete('/api/aws-credentials', authenticateToken, async (req, res) => {
    const userId = req.user.userId.toString();
    
    try {
        await awsCredentialsCollection.deleteOne({ userId });
        res.json({
            success: true,
            message: "Credentials cleared"
        });
    } catch (error) {
        console.error("❌ Error deleting AWS credentials:", error);
        res.status(500).json({
            success: false,
            message: "Failed to clear credentials"
        });
    }
});

// 3. Dashboard Data Route (Protected)
app.post('/api/dashboard', authenticateToken, async (req, res) => {
    const { awsAccessKey, awsSecretKey } = req.body;
    const userId = req.user.userId.toString();

    console.log(`\n🔍 Dashboard request from user: ${req.user.username}`);

    if (!awsAccessKey || !awsSecretKey) {
        return res.status(400).json({ 
            success: false, 
            message: "AWS Access Key and Secret Key are required" 
        });
    }

    try {
        // Step 1: Validate AWS credentials first
        const validation = await validateAWSCredentials(awsAccessKey, awsSecretKey);
        
        if (!validation.valid) {
            console.log("❌ AWS credential validation failed");
            return res.status(401).json({ 
                success: false, 
                message: validation.error,
                credentialsInvalid: true
            });
        }
        
        console.log(`✅ Credentials validated for AWS Account: ${validation.accountId}`);
        
        // Step 1.5: Save AWS credentials to MongoDB (user-specific)
        try {
            await awsCredentialsCollection.updateOne(
                { userId },
                { 
                    $set: { 
                        awsAccessKey, 
                        awsSecretKey, 
                        accountId: validation.accountId,
                        updatedAt: new Date()
                    } 
                },
                { upsert: true }
            );
            console.log("💾 AWS credentials saved to database");
        } catch (credSaveError) {
            console.error("⚠️ Failed to save credentials:", credSaveError.message);
            // Continue anyway - this is not critical for the current request
        }
        
        // Step 2: Fetch REAL AWS data ONLY - NO SIMULATION/FALLBACK
        let awsResult = await fetchRealAWSData(awsAccessKey, awsSecretKey);
        
        // If AWS API fails, return error - NO SIMULATION ALLOWED
        if (!awsResult.success) {
            return res.status(400).json({ 
                success: false, 
                message: awsResult.message || "Failed to fetch AWS data. Please ensure your credentials have proper permissions for EC2, CloudWatch, Cost Explorer, Lambda, and RDS services."
            });
        }

        const currentData = awsResult.data;

        // Step 2: Retrieve Historical Data
        let historyData = [];
        try {
            historyData = await historyCollection
                .find({ userId })
                .sort({ timestamp: -1 })
                .limit(5)
                .toArray();
            
            console.log(`📊 Retrieved ${historyData.length} historical records`);
        } catch (e) {
            console.error("⚠️ Could not fetch history:", e.message);
        }
        
        // Step 3: Get AI Advice (with historical context)
        console.log("🤖 Generating AI optimization advice...");
        const adviceText = await getGeminiAdvice(currentData, historyData);

        // Step 4: Save new data point to history
        try {
            const historyEntry = { 
                userId, 
                username: req.user.username,
                ...currentData,
                analyzedAt: new Date()
            };
            await historyCollection.insertOne(historyEntry);
            console.log("✅ Analysis saved to history");
        } catch (e) {
            console.error("⚠️ Could not save history:", e.message);
        }

        // Step 5: Send response with REAL AWS data only
        res.json({
            success: true,
            awsData: {
                ...currentData,
                accountId: validation.accountId,
                awsArn: validation.arn
            },
            aiAdvice: adviceText,
            history: historyData,
            validatedAccount: validation.accountId,
            message: `Real AWS data retrieved successfully from account ${validation.accountId}`
        });

        console.log("✅ Dashboard data sent successfully\n");

    } catch (error) {
        console.error("❌ Dashboard error:", error);
        res.status(500).json({ 
            success: false, 
            message: "Server error while fetching dashboard data",
            error: error.message 
        });
    }
});

// 4. Get User's Historical Data
app.get('/api/history', authenticateToken, async (req, res) => {
    const userId = req.user.userId.toString();
    const limit = parseInt(req.query.limit) || 10;

    try {
        const history = await historyCollection
            .find({ userId })
            .sort({ timestamp: -1 })
            .limit(limit)
            .toArray();

        res.json({
            success: true,
            history,
            count: history.length
        });
    } catch (error) {
        console.error("❌ History fetch error:", error);
        res.status(500).json({ 
            success: false, 
            message: "Could not retrieve history" 
        });
    }
});

// 5. Health Check Endpoint
app.get('/api/health', (req, res) => {
    res.json({ 
        status: 'healthy', 
        timestamp: new Date().toISOString(),
        mongodb: db ? 'connected' : 'disconnected',
        geminiApi: geminiAvailable ? 'available' : 'using fallback'
    });
});

// 6. Gemini Query Endpoint (For interactive Q&A)
app.post('/api/gemini-query', authenticateToken, async (req, res) => {
    const { question, context } = req.body;
    const userId = req.user.userId.toString();

    if (!question) {
        return res.status(400).json({ success: false, message: 'Question is required' });
    }

    if (!genAI) {
        return res.status(503).json({ 
            success: false, 
            message: 'Gemini API is not configured. Please add GEMINI_API_KEY to your environment variables.' 
        });
    }

    try {
        console.log(`💬 Chatbot query from ${req.user.username}: "${question}"`);
        
        // Get user's latest AWS data for context
        const latestHistory = await historyCollection
            .findOne({ userId }, { sort: { timestamp: -1 } });
        
        const currentTime = new Date().toLocaleString('en-US', { 
            weekday: 'long', 
            year: 'numeric', 
            month: 'long', 
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit'
        });
        
        let prompt = `You are an AWS cloud cost optimization expert assistant. Answer in PLAIN TEXT only (NO markdown formatting).

Current Date and Time: ${currentTime}

User Question: ${question}

STRICT REQUIREMENTS:
- Maximum 200 words
- Plain text format - NO markdown symbols (no **, ##, -, *, etc.)
- Write in clear paragraphs with natural sentences
- Use line breaks between paragraphs for readability
- NO bold, NO headers, NO bullet points, NO numbered lists
- Just conversational, helpful text
- For AWS questions, provide specific, actionable advice`;

        if (context && latestHistory) {
            prompt += `\n\nUser's AWS Infrastructure Context:\nMonthly Cost: $${latestHistory.totalMonthlyCost}\nInstances: ${latestHistory.totalInstances || 0}\nUnderutilized EC2: ${latestHistory.underutilizedEC2?.length || 0}\nUnderutilized EBS: ${latestHistory.underutilizedEBS?.length || 0}\n\nUse this context to provide personalized recommendations.`;
        }

        const answer = await generateWithGemini(prompt);
        console.log(`📝 Response preview: ${answer.substring(0, 100)}...`);

        res.json({
            success: true,
            question,
            answer,
            source: 'gemini',
            model: workingModel,
            timestamp: new Date().toISOString()
        });

    } catch (error) {
        console.error('❌ Gemini query error:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Failed to process your question',
            error: error.message 
        });
    }
});

// Default route to redirect to login page
app.get('/', (req, res) => {
    res.redirect('/pages/index.html');
});

// ========== INSTANCE LIMIT MANAGEMENT ==========

// In-memory cache for monitoring state (temporary, resets on server restart)
const instanceMonitoring = new Map();

// Get instance limits from MongoDB
app.get('/api/instance-limits', authenticateToken, async (req, res) => {
    const userId = req.user.userId.toString();
    
    try {
        const userLimits = await instanceLimitsCollection.find({ userId }).toArray();
        
        res.json({ 
            success: true, 
            limits: userLimits.map(limit => ({
                instanceId: limit.instanceId,
                cpuLimit: limit.cpuLimit,
                autoShutdown: limit.autoShutdown,
                createdAt: limit.createdAt,
                breachCount: limit.breachCount || 0,
                lastBreach: limit.lastBreach
            }))
        });
    } catch (error) {
        console.error('Error fetching instance limits:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});

// Set instance limit (save to MongoDB)
app.post('/api/instance-limits', authenticateToken, async (req, res) => {
    const userId = req.user.userId.toString();
    const { instanceId, cpuLimit, autoShutdown } = req.body;
    
    if (!instanceId || !cpuLimit) {
        return res.status(400).json({ success: false, message: 'Instance ID and CPU limit required' });
    }
    
    try {
        const limitData = {
            userId,
            instanceId,
            cpuLimit: parseFloat(cpuLimit),
            autoShutdown: autoShutdown !== false,
            createdAt: new Date(),
            breachCount: 0,
            lastBreach: null
        };
        
        // Upsert: update if exists, insert if not
        await instanceLimitsCollection.updateOne(
            { userId, instanceId },
            { $set: limitData },
            { upsert: true }
        );
        
        console.log(`✅ Limit saved to DB for instance ${instanceId}: CPU ${cpuLimit}%`);
        
        res.json({ 
            success: true, 
            message: 'Instance limit set successfully and saved',
            instanceId,
            cpuLimit,
            autoShutdown
        });
    } catch (error) {
        console.error('Error setting instance limit:', error);
        res.status(500).json({ success: false, message: 'Failed to save instance limit' });
    }
});

// Delete instance limit from MongoDB
app.delete('/api/instance-limits/:instanceId', authenticateToken, async (req, res) => {
    const userId = req.user.userId.toString();
    const { instanceId } = req.params;
    
    try {
        await instanceLimitsCollection.deleteOne({ userId, instanceId });
        
        const limitKey = `${userId}:${instanceId}`;
        instanceMonitoring.delete(limitKey);
        
        console.log(`✅ Limit removed from DB for instance ${instanceId}`);
        
        res.json({ success: true, message: 'Instance limit removed successfully' });
    } catch (error) {
        console.error('Error removing instance limit:', error);
        res.status(500).json({ success: false, message: 'Failed to remove instance limit' });
    }
});

// Monitor instance and trigger auto-shutdown
app.post('/api/monitor-instance', authenticateToken, async (req, res) => {
    const userId = req.user.userId.toString();
    const { instanceId, currentCPU, awsAccessKey, awsSecretKey } = req.body;
    
    try {
        // Fetch limit from MongoDB
        const limit = await instanceLimitsCollection.findOne({ userId, instanceId });
        
        if (!limit) {
            return res.json({ 
                success: true, 
                action: 'none', 
                message: 'No limit set for this instance' 
            });
        }
        
        const limitKey = `${userId}:${instanceId}`;
        
        // Check if CPU exceeds limit
        if (currentCPU > limit.cpuLimit) {
            console.log(`⚠️  Instance ${instanceId} CPU (${currentCPU}%) exceeds limit (${limit.cpuLimit}%)`);
            
            // Update breach count in MongoDB
            await instanceLimitsCollection.updateOne(
                { userId, instanceId },
                { 
                    $inc: { breachCount: 1 },
                    $set: { lastBreach: new Date() }
                }
            );
        
        // Get monitoring state
        let monitorState = instanceMonitoring.get(limitKey) || {
            alertShown: false,
            shutdownScheduled: false,
            shutdownTime: null
        };
        
        if (!monitorState.alertShown) {
            // First breach - show alert
            monitorState.alertShown = true;
            monitorState.shutdownScheduled = true;
            monitorState.shutdownTime = new Date(Date.now() + 30000); // 30 seconds
            instanceMonitoring.set(limitKey, monitorState);
            
            console.log(`🔔 Alert triggered for ${instanceId}, auto-shutdown in 30 seconds`);
            
            return res.json({
                success: true,
                action: 'alert',
                message: `Instance ${instanceId} CPU usage (${currentCPU}%) exceeded limit (${limit.cpuLimit}%)`,
                shutdownIn: 30,
                currentCPU,
                limit: limit.cpuLimit
            });
        } else if (monitorState.shutdownScheduled && Date.now() >= monitorState.shutdownTime.getTime()) {
            // Time to shutdown
            if (limit.autoShutdown && awsAccessKey && awsSecretKey) {
                try {
                    console.log(`🛑 Initiating auto-shutdown for ${instanceId}`);
                    
                    const credentials = {
                        accessKeyId: awsAccessKey,
                        secretAccessKey: awsSecretKey
                    };
                    
                    // Stop instance directly
                    const ec2Client = new EC2Client({ region: AWS_REGION, credentials });
                    const stopCommand = new StopInstancesCommand({
                        InstanceIds: [instanceId]
                    });
                    
                    const stopResponse = await ec2Client.send(stopCommand);
                    const stoppedInstance = stopResponse.StoppingInstances?.[0];
                    
                    console.log(`✅ Instance ${instanceId} stopped successfully`);
                    console.log(`   Previous state: ${stoppedInstance.PreviousState.Name}`);
                    console.log(`   Current state: ${stoppedInstance.CurrentState.Name}`);
                    
                    // Reset monitoring state
                    instanceMonitoring.delete(limitKey);
                    
                    return res.json({
                        success: true,
                        action: 'stopped',
                        message: `Instance ${instanceId} automatically stopped due to high CPU usage`,
                        instanceId,
                        previousState: stoppedInstance.PreviousState.Name,
                        currentState: stoppedInstance.CurrentState.Name,
                        reason: `CPU ${currentCPU}% exceeded limit ${limit.cpuLimit}%`,
                        timestamp: new Date().toISOString()
                    });
                    
                } catch (error) {
                    console.error(`❌ Failed to stop instance ${instanceId}:`, error.message);
                    return res.status(500).json({
                        success: false,
                        action: 'error',
                        message: `Failed to stop instance: ${error.message}`
                    });
                }
            } else {
                return res.json({
                    success: true,
                    action: 'manual_required',
                    message: 'Auto-shutdown disabled or credentials missing'
                });
            }
        } else {
            // Still in countdown
            const remainingSeconds = Math.ceil((monitorState.shutdownTime.getTime() - Date.now()) / 1000);
            return res.json({
                success: true,
                action: 'countdown',
                message: `Auto-shutdown in ${remainingSeconds} seconds`,
                remainingSeconds,
                currentCPU,
                limit: limit.cpuLimit
            });
        }
    } else {
        // CPU within limits - reset monitoring
        if (instanceMonitoring.has(limitKey)) {
            instanceMonitoring.delete(limitKey);
            console.log(`✅ Instance ${instanceId} CPU back to normal (${currentCPU}%)`);
        }
        
        return res.json({
            success: true,
            action: 'none',
            message: 'Instance within limits',
            currentCPU,
            limit: limit.cpuLimit
        });
    }
    } catch (error) {
        console.error('Error monitoring instance:', error);
        return res.status(500).json({ success: false, message: 'Failed to monitor instance' });
    }
});

// Get active alerts
app.get('/api/active-alerts', authenticateToken, async (req, res) => {
    const userId = req.user.userId.toString();
    
    try {
        const alerts = [];
        for (const [key, monitorState] of instanceMonitoring.entries()) {
            if (key.startsWith(userId) && monitorState.shutdownScheduled) {
                const instanceId = key.split(':')[1];
                const limit = await instanceLimitsCollection.findOne({ userId, instanceId });
                const remainingSeconds = Math.max(0, Math.ceil((monitorState.shutdownTime.getTime() - Date.now()) / 1000));
                
                alerts.push({
                    instanceId,
                    limit: limit?.cpuLimit,
                    shutdownIn: remainingSeconds,
                    breachCount: limit?.breachCount || 0
                });
            }
        }
        
        res.json({ success: true, alerts });
    } catch (error) {
        console.error('Error fetching active alerts:', error);
        res.status(500).json({ success: false, message: 'Failed to fetch alerts' });
    }
});

// --- Server Start ---
// Connect to MongoDB on startup
connectDB().catch(err => {
    console.error('Failed to connect to MongoDB on startup:', err);
});

// For local development
if (process.env.NODE_ENV !== 'production') {
    app.listen(port, () => {
        console.log(`\n🚀 Server running at http://localhost:${port}`);
        console.log(`📊 MongoDB: Connected`);
        console.log(`🤖 Gemini AI: ${genAI ? (workingModel ? `Ready (${workingModel})` : 'Auto-detect mode') : 'Not configured'}`);
        console.log(`🔗 Access the app: http://localhost:${port}\n`);
    });
}

// Export for Vercel serverless
module.exports = app;
