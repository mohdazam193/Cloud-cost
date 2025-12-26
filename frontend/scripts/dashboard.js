// Track current active section
let currentActiveSection = 'dashboard';

function renderMarkdown(text) {
    if (typeof marked === 'undefined') {
        return text;
    }
    const rawHtml = marked.parse(text);
    return typeof DOMPurify !== 'undefined' ? DOMPurify.sanitize(rawHtml) : rawHtml;
}

// Utility: Show custom modal
function showMessage(title, message, isError = false) {
    const modal = document.getElementById('messageModal');
    const modalTitle = document.getElementById('modalTitle');
    const modalMessage = document.getElementById('modalMessage');
    const modalOkButton = document.getElementById('modalOkButton');

    modalTitle.textContent = title;
    modalMessage.textContent = message;
    modalTitle.style.color = isError ? 'var(--color-error)' : 'var(--color-primary)';
    
    modalOkButton.onclick = () => {
        modal.style.display = 'none';
    };
    
    modal.style.display = 'block';
}

// Auth check
function checkAuth() {
    const token = localStorage.getItem('authToken');
    if (!token) {
        alert('You must log in to view the dashboard.');
        window.location.href = '../pages/index.html';
        return false;
    }
    return true;
}

// Get JWT token
function getAuthToken() {
    return localStorage.getItem('authToken');
}

// Format currency
function formatCurrency(amount) {
    return `$${parseFloat(amount).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

// Format date
function formatDate(dateString) {
    const date = new Date(dateString);
    return date.toLocaleString('en-US', { 
        month: 'short', 
        day: 'numeric', 
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
    });
}

// Render comprehensive dashboard
function renderDashboard(data) {
    const { awsData, aiAdvice, history, isSimulated, validatedAccount } = data;

    // Update data mode indicator
    const dataMode = document.getElementById('dataMode');
    if (dataMode) {
        dataMode.textContent = 'Real-Time Data';
        dataMode.style.color = isSimulated ? 'var(--color-warning)' : 'var(--color-success)';
    }

    // Update AWS Account Info
    const awsAccountInfo = document.getElementById('awsAccountInfo');
    if (awsAccountInfo && validatedAccount) {
        awsAccountInfo.textContent = `AWS Account: ${validatedAccount}`;
        awsAccountInfo.style.color = '#4CAF50';
    }

    // Update last refresh time
    const lastUpdate = document.getElementById('lastUpdate');
    if (lastUpdate) {
        lastUpdate.textContent = `Last updated: ${formatDate(awsData.timestamp)}`;
    }

    // === Cost Overview ===
    document.getElementById('currentCost').textContent = formatCurrency(awsData.totalMonthlyCost);
    document.getElementById('potentialSavings').textContent = formatCurrency(awsData.savingsOpportunities);
    document.getElementById('forecastedCost').textContent = formatCurrency(awsData.forecastedCost || awsData.totalMonthlyCost);
    document.getElementById('annualSavings').textContent = formatCurrency(awsData.savingsOpportunities * 12);

    // Cost change indicator
    if (history && history.length > 0) {
        const previousCost = parseFloat(history[0].totalMonthlyCost);
        const currentCost = parseFloat(awsData.totalMonthlyCost);
        const change = ((currentCost - previousCost) / previousCost * 100).toFixed(1);
        const costChange = document.getElementById('costChange');
        
        if (change > 0) {
            costChange.textContent = `▲ +${change}% from last check`;
            costChange.className = 'metric-change negative';
        } else if (change < 0) {
            costChange.textContent = `▼ ${change}% from last check`;
            costChange.className = 'metric-change positive';
        } else {
            costChange.textContent = 'No change';
            costChange.className = 'metric-change';
        }
    }

    // === Cost Breakdown Chart ===
    renderCostBreakdown(awsData.costBreakdown || {});

    // === Infrastructure Overview ===
    document.getElementById('totalInstances').textContent = awsData.totalInstances || 0;
    document.getElementById('runningInstances').textContent = awsData.runningInstances || 0;
    document.getElementById('stoppedInstances').textContent = awsData.stoppedInstances || 0;
    
    document.getElementById('totalVolumes').textContent = awsData.totalVolumes || 0;
    document.getElementById('totalStorageGB').textContent = awsData.totalStorageGB || 0;
    document.getElementById('unattachedVolumes').textContent = awsData.unattachedVolumes || 0;
    
    document.getElementById('totalSnapshots').textContent = awsData.totalSnapshots || 0;
    document.getElementById('oldSnapshots').textContent = awsData.oldSnapshots?.length || 0;
    
    document.getElementById('totalLambda').textContent = awsData.totalLambdaFunctions || 0;
    document.getElementById('underutilizedLambda').textContent = awsData.underutilizedLambda?.length || 0;
    
    document.getElementById('totalRDS').textContent = awsData.totalRDSInstances || 0;

    // === EC2 Issues ===
    renderEC2Issues(awsData.underutilizedEC2 || []);

    // === EBS Issues ===
    renderEBSIssues(awsData.underutilizedEBS || []);

    // === Snapshot Issues ===
    renderSnapshotIssues(awsData.oldSnapshots || []);

    // === RDS Issues ===
    renderRDSIssues(awsData.underutilizedRDS || []);

    // === AI Advice (Split into sections) ===
    renderAIAdvice(aiAdvice);

    // === Historical Trends ===
    renderHistory(history || []);

    // Show dashboard content
    document.getElementById('loadingState').style.display = 'none';
    document.getElementById('dashboardContent').style.display = 'block';

    // Smooth scroll to top
    window.scrollTo({ top: 0, behavior: 'smooth' });
}

// Render AI Advice Split into Sections
function renderAIAdvice(aiAdvice) {
    console.log('🤖 Rendering AI Advice...');
    console.log('📝 AI Advice Length:', aiAdvice.length, 'characters');
    console.log('📄 AI Advice Preview:', aiAdvice.substring(0, 200));
    
    const fullMarkdown = renderMarkdown(aiAdvice);
    
    // Parse sections from the markdown content
    const sections = {
        critical: '',
        quickWins: '',
        longTerm: '',
        savings: ''
    };
    
    // Split by headers and identify sections
    const lines = aiAdvice.split('\n');
    let currentSection = '';
    let currentContent = [];
    
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const lower = line.toLowerCase();
        
        // Detect section headers
        if (lower.includes('critical') || lower.includes('biggest') || lower.includes('issue')) {
            if (currentSection) {
                sections[currentSection] = currentContent.join('\n');
            }
            currentSection = 'critical';
            currentContent = [line];
        } else if (lower.includes('quick win') || lower.includes('immediate') || lower.includes('action')) {
            if (currentSection) {
                sections[currentSection] = currentContent.join('\n');
            }
            currentSection = 'quickWins';
            currentContent = [line];
        } else if (lower.includes('long-term') || lower.includes('strategy') || lower.includes('strategic')) {
            if (currentSection) {
                sections[currentSection] = currentContent.join('\n');
            }
            currentSection = 'longTerm';
            currentContent = [line];
        } else if (lower.includes('saving') || lower.includes('impact') || lower.includes('cost reduction')) {
            if (currentSection) {
                sections[currentSection] = currentContent.join('\n');
            }
            currentSection = 'savings';
            currentContent = [line];
        } else if (currentSection) {
            currentContent.push(line);
        }
    }
    
    // Add the last section
    if (currentSection && currentContent.length > 0) {
        sections[currentSection] = currentContent.join('\n');
    }
    
    // If sections are empty, try to split the content evenly
    if (!sections.critical && !sections.quickWins && !sections.longTerm && !sections.savings) {
        const paragraphs = aiAdvice.split('\n\n').filter(p => p.trim());
        const quarterLength = Math.ceil(paragraphs.length / 4);
        
        sections.critical = paragraphs.slice(0, quarterLength).join('\n\n');
        sections.quickWins = paragraphs.slice(quarterLength, quarterLength * 2).join('\n\n');
        sections.longTerm = paragraphs.slice(quarterLength * 2, quarterLength * 3).join('\n\n');
        sections.savings = paragraphs.slice(quarterLength * 3).join('\n\n');
    }
    
    // Render each section
    document.getElementById('aiCriticalIssues').innerHTML = renderMarkdown(sections.critical || '✓ No critical issues detected');
    document.getElementById('aiQuickWins').innerHTML = renderMarkdown(sections.quickWins || '⚡ Analyzing quick wins...');
    document.getElementById('aiLongTerm').innerHTML = renderMarkdown(sections.longTerm || '📈 Building long-term strategy...');
    document.getElementById('aiSavingsImpact').innerHTML = renderMarkdown(sections.savings || '💰 Calculating savings potential...');
}

// Render cost breakdown chart
function renderCostBreakdown(breakdown) {
    const container = document.getElementById('costBreakdownChart');
    container.innerHTML = '';

    if (Object.keys(breakdown).length === 0) {
        container.innerHTML = '<p style="color: var(--color-text-secondary); text-align: center; padding: 20px;">No cost breakdown data available</p>';
        return;
    }

    const maxCost = Math.max(...Object.values(breakdown).map(v => parseFloat(v)));
    
    Object.entries(breakdown).forEach(([service, cost]) => {
        const percentage = (parseFloat(cost) / maxCost) * 100;
        
        const bar = document.createElement('div');
        bar.className = 'chart-bar';
        bar.innerHTML = `
            <div class="chart-label">${service}</div>
            <div class="chart-bar-bg">
                <div class="chart-bar-fill" style="width: ${percentage}%">
                    ${percentage > 20 ? formatCurrency(cost) : ''}
                </div>
            </div>
            <div class="chart-value">${formatCurrency(cost)}</div>
        `;
        container.appendChild(bar);
    });
}

// Render EC2 issues
function renderEC2Issues(issues) {
    const container = document.getElementById('ec2IssuesList');
    const badge = document.getElementById('ec2Badge');
    
    badge.textContent = issues.length;
    container.innerHTML = '';

    if (issues.length === 0) {
        container.innerHTML = '<div class="issue-item" style="border-left-color: var(--color-success);"><div class="issue-title">✓ All EC2 instances are properly utilized</div></div>';
        return;
    }

    issues.forEach(issue => {
        const item = document.createElement('div');
        item.className = 'issue-item critical';
        item.innerHTML = `
            <div class="issue-header">
                <div class="issue-title">🖥️ ${issue.id} (${issue.type || 'Unknown'})</div>
                <div class="savings-badge">Save $${issue.estimatedSavings || 35}/mo</div>
            </div>
            <div class="issue-details">
                <strong>CPU Average:</strong> ${issue.cpuAvg || 'N/A'} | 
                <strong>CPU Max:</strong> ${issue.cpuMax || 'N/A'}<br>
                ${issue.networkIn ? `<strong>Network In:</strong> ${issue.networkIn}<br>` : ''}
                ${issue.reason}
            </div>
            <div class="issue-recommendation">
                💡 Recommendation: ${issue.recommendation || 'Consider downsizing or termination'}
            </div>
        `;
        container.appendChild(item);
    });
}

// Render EBS issues
function renderEBSIssues(issues) {
    const container = document.getElementById('ebsIssuesList');
    const badge = document.getElementById('ebsBadge');
    
    badge.textContent = issues.length;
    container.innerHTML = '';

    if (issues.length === 0) {
        container.innerHTML = '<div class="issue-item" style="border-left-color: var(--color-success);"><div class="issue-title">✓ All EBS volumes are optimally used</div></div>';
        return;
    }

    issues.forEach(issue => {
        const item = document.createElement('div');
        item.className = 'issue-item moderate';
        item.innerHTML = `
            <div class="issue-header">
                <div class="issue-title">💾 ${issue.id}</div>
                <div class="savings-badge">Save $${issue.estimatedSavings || 15}/mo</div>
            </div>
            <div class="issue-details">
                <strong>Size:</strong> ${issue.size} | 
                <strong>Type:</strong> ${issue.type || 'N/A'} | 
                <strong>Usage:</strong> ${issue.usage}<br>
                ${issue.reason}
            </div>
            <div class="issue-recommendation">
                💡 Recommendation: ${issue.recommendation}
            </div>
        `;
        container.appendChild(item);
    });
}

// Render snapshot issues
function renderSnapshotIssues(issues) {
    const container = document.getElementById('snapshotsList');
    const badge = document.getElementById('snapshotBadge');
    
    badge.textContent = issues.length;
    container.innerHTML = '';

    if (issues.length === 0) {
        container.innerHTML = '<div class="issue-item" style="border-left-color: var(--color-success);"><div class="issue-title">✓ No old snapshots found</div></div>';
        return;
    }

    issues.slice(0, 5).forEach(issue => {
        const item = document.createElement('div');
        item.className = 'issue-item low';
        item.innerHTML = `
            <div class="issue-header">
                <div class="issue-title">📸 ${issue.id}</div>
                <div class="savings-badge">Save $${issue.estimatedSavings || 2}/mo</div>
            </div>
            <div class="issue-details">
                <strong>Size:</strong> ${issue.size} | <strong>Age:</strong> ${issue.age} days<br>
                ${issue.reason}
            </div>
            <div class="issue-recommendation">
                💡 Recommendation: Review and delete if no longer needed
            </div>
        `;
        container.appendChild(item);
    });

    if (issues.length > 5) {
        container.innerHTML += `<p style="text-align: center; color: var(--color-text-secondary); margin-top: 12px;">+ ${issues.length - 5} more snapshots</p>`;
    }
}

// Render RDS issues
function renderRDSIssues(issues) {
    const container = document.getElementById('rdsList');
    const badge = document.getElementById('rdsBadge');
    
    badge.textContent = issues.length;
    container.innerHTML = '';

    if (issues.length === 0) {
        container.innerHTML = '<div class="issue-item" style="border-left-color: var(--color-success);"><div class="issue-title">✓ All RDS instances are properly sized</div></div>';
        return;
    }

    issues.forEach(issue => {
        const item = document.createElement('div');
        item.className = 'issue-item moderate';
        item.innerHTML = `
            <div class="issue-header">
                <div class="issue-title">🗄️ ${issue.id}</div>
                <div class="savings-badge">Save $${issue.estimatedSavings || 50}/mo</div>
            </div>
            <div class="issue-details">
                <strong>Type:</strong> ${issue.type} | 
                <strong>Engine:</strong> ${issue.engine || 'N/A'}<br>
                <strong>CPU Average:</strong> ${issue.cpuAvg} | 
                <strong>Connections:</strong> ${issue.connections}<br>
                ${issue.reason}
            </div>
            <div class="issue-recommendation">
                💡 Recommendation: ${issue.recommendation}
            </div>
        `;
        container.appendChild(item);
    });
}

// Render history
// Render AWS Billing History (Last 4 Months)
let historyChart = null;

function renderHistory(history) {
    const container = document.getElementById('historyContent');
    container.innerHTML = '';

    if (history.length === 0) {
        container.innerHTML = '<p style="text-align: center; color: var(--color-text-secondary); padding: 40px;">No historical data yet. Run multiple analyses to see trends.</p>';
        document.getElementById('historyChart').parentElement.innerHTML = '<p style="text-align: center; color: var(--color-text-secondary); padding: 60px;">Chart will appear after multiple analyses</p>';
        return;
    }

    // Render history items
    history.forEach((item, index) => {
        const costChange = index < history.length - 1 
            ? ((parseFloat(item.totalMonthlyCost) - parseFloat(history[index + 1].totalMonthlyCost)) / parseFloat(history[index + 1].totalMonthlyCost) * 100).toFixed(1)
            : null;

        const historyItem = document.createElement('div');
        historyItem.className = 'history-item';
        historyItem.innerHTML = `
            <div class="history-date">${formatDate(item.timestamp || item.analyzedAt)}</div>
            <div class="history-metrics">
                <div><strong>EC2 Issues:</strong> ${item.underutilizedEC2?.length || 0}</div>
                <div><strong>EBS Issues:</strong> ${item.underutilizedEBS?.length || 0}</div>
                <div><strong>Savings:</strong> ${formatCurrency(item.savingsOpportunities || 0)}</div>
            </div>
            <div class="history-cost">
                ${formatCurrency(item.totalMonthlyCost)}
                ${costChange !== null ? (costChange > 0 ? `<span style="color: var(--color-error); font-size: 0.7em;">▲${costChange}%</span>` : `<span style="color: var(--color-success); font-size: 0.7em;">▼${costChange}%</span>`) : ''}
            </div>
        `;
        container.appendChild(historyItem);
    });

    // Render colorful line chart
    renderHistoryChart(history);
    
    // Render auto-stopped instances history
    renderAutoStoppedHistory();
}

function renderHistoryChart(history) {
    const canvas = document.getElementById('historyChart');
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    
    // Destroy existing chart
    if (historyChart) {
        historyChart.destroy();
    }

    // Prepare data (reverse to show oldest to newest)
    const sortedHistory = [...history].reverse();
    const labels = sortedHistory.map(item => {
        const date = new Date(item.timestamp || item.analyzedAt);
        return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    });
    
    const costData = sortedHistory.map(item => parseFloat(item.totalMonthlyCost));
    const savingsData = sortedHistory.map(item => parseFloat(item.savingsOpportunities || 0));

    historyChart = new Chart(ctx, {
        type: 'line',
        data: {
            labels: labels,
            datasets: [
                {
                    label: 'Monthly Cost',
                    data: costData,
                    borderColor: '#ff6b9d',
                    backgroundColor: 'rgba(255, 107, 157, 0.1)',
                    borderWidth: 3,
                    fill: true,
                    tension: 0.4,
                    pointRadius: 6,
                    pointBackgroundColor: '#ff6b9d',
                    pointBorderColor: '#fff',
                    pointBorderWidth: 2,
                    pointHoverRadius: 8
                },
                {
                    label: 'Savings Opportunities',
                    data: savingsData,
                    borderColor: '#4ecdc4',
                    backgroundColor: 'rgba(78, 205, 196, 0.1)',
                    borderWidth: 3,
                    fill: true,
                    tension: 0.4,
                    pointRadius: 6,
                    pointBackgroundColor: '#4ecdc4',
                    pointBorderColor: '#fff',
                    pointBorderWidth: 2,
                    pointHoverRadius: 8
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: true,
            plugins: {
                legend: {
                    display: true,
                    position: 'top',
                    labels: {
                        font: {
                            family: 'Poppins',
                            size: 13,
                            weight: '600'
                        },
                        padding: 15,
                        usePointStyle: true,
                        pointStyle: 'circle'
                    }
                },
                tooltip: {
                    backgroundColor: 'rgba(0, 0, 0, 0.8)',
                    titleFont: {
                        family: 'Poppins',
                        size: 14,
                        weight: '600'
                    },
                    bodyFont: {
                        family: 'Poppins',
                        size: 13
                    },
                    padding: 12,
                    cornerRadius: 8,
                    displayColors: true,
                    callbacks: {
                        label: function(context) {
                            return context.dataset.label + ': $' + context.parsed.y.toFixed(2);
                        }
                    }
                }
            },
            scales: {
                y: {
                    beginAtZero: true,
                    ticks: {
                        callback: function(value) {
                            return '$' + value.toFixed(0);
                        },
                        font: {
                            family: 'Poppins',
                            size: 12
                        }
                    },
                    grid: {
                        color: 'rgba(255, 107, 157, 0.1)',
                        drawBorder: false
                    }
                },
                x: {
                    ticks: {
                        font: {
                            family: 'Poppins',
                            size: 12
                        }
                    },
                    grid: {
                        display: false,
                        drawBorder: false
                    }
                }
            },
            interaction: {
                intersect: false,
                mode: 'index'
            }
        }
    });
}

// === Load Saved AWS Credentials (User-Specific) ===
async function loadSavedCredentials() {
    const token = localStorage.getItem('authToken');
    if (!token) return;

    // IMPORTANT: Always clear form fields first to prevent showing previous user's data
    document.getElementById('awsAccessKey').value = '';
    document.getElementById('awsSecretKey').value = '';

    try {
        const response = await fetch('/api/aws-credentials', {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${token}`
            }
        });

        if (response.ok) {
            const data = await response.json();
            if (data.success && data.awsAccessKey) {
                // Only load access key, user must re-enter secret key for security
                document.getElementById('awsAccessKey').value = data.awsAccessKey;
                console.log('✅ Loaded saved AWS access key for this user');
            } else {
                console.log('ℹ️ No saved credentials for this user');
            }
        }
    } catch (error) {
        console.error('Failed to load saved credentials:', error);
    }
}

// === Main Dashboard Logic ===
document.addEventListener('DOMContentLoaded', () => {
    if (!checkAuth()) return;

    // Display user info
    const username = localStorage.getItem('username');
    if (username) {
        document.getElementById('userName').textContent = username;
    }

    // Load saved AWS credentials from server (user-specific)
    loadSavedCredentials();

    // Main form submission
    const dashboardForm = document.getElementById('dashboardForm');
    dashboardForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        await analyzeAWS();
    });

    // Refresh advice button (in Instance Limit Management section)
    document.getElementById('refreshAdvice')?.addEventListener('click', async () => {
        const button = document.getElementById('refreshAdvice');
        button.disabled = true;
        button.innerHTML = '<i class="fa-solid fa-arrows-rotate"></i> Refreshing...';
        
        await analyzeAWS();
        
        button.disabled = false;
        button.innerHTML = '<i class="fa-solid fa-arrows-rotate"></i> Refresh';
    });

    // Refresh advice button (in AI Assistant section)
    document.getElementById('refreshAdviceAI')?.addEventListener('click', async () => {
        const button = document.getElementById('refreshAdviceAI');
        button.disabled = true;
        button.innerHTML = '<i class="fa-solid fa-arrows-rotate"></i> Refreshing...';
        
        await analyzeAWS();
        
        button.disabled = false;
        button.innerHTML = '<i class="fa-solid fa-arrows-rotate"></i> Refresh';
    });

    // Ask AI button
    document.getElementById('askButton').addEventListener('click', async () => {
        await askGemini();
    });

    // Quick question chips
    document.querySelectorAll('.chip-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const question = btn.getAttribute('data-question');
            document.getElementById('userQuery').value = question;
            askGemini();
        });
    });

    // Logout - Define logout function if not already defined
    if (typeof window.logout !== 'function') {
        window.logout = async function() {
            console.log('Logging out...');
            
            // Clear form fields immediately to prevent next user from seeing them
            document.getElementById('awsAccessKey').value = '';
            document.getElementById('awsSecretKey').value = '';
            
            // Clear all local storage
            localStorage.removeItem('authToken');
            localStorage.removeItem('username');
            localStorage.removeItem('awsCredentials');
            localStorage.removeItem('lastAnalysis');
            localStorage.removeItem('autoStoppedHistory');
            
            // Note: We keep credentials in MongoDB so the user can access them on next login
            // Each user's credentials are isolated by userId in the database
            
            window.location.href = '/pages/index.html';
        };
    }
    
    const logoutBtn = document.getElementById('logoutButton');
    if (logoutBtn) {
        logoutBtn.addEventListener('click', (e) => {
            e.preventDefault();
            if (confirm('Are you sure you want to logout?')) {
                window.logout();
            }
        });
    }

    // Auto-refresh entire dashboard every 30 seconds
    let autoRefreshInterval = null;
    let countdownInterval = null;
    let hasAnalyzedOnce = false;
    let lastAwsCredentials = null;
    let isBackgroundRefreshing = false;
    let secondsUntilRefresh = 30;

    const updateCountdown = () => {
        const nextRefreshEl = document.getElementById('nextRefresh');
        if (nextRefreshEl && hasAnalyzedOnce) {
            nextRefreshEl.textContent = `Next refresh in: ${secondsUntilRefresh}s`;
            secondsUntilRefresh--;
            if (secondsUntilRefresh < 0) {
                secondsUntilRefresh = 30;
            }
        }
    };

    const refreshDashboardInBackground = async () => {
        if (!lastAwsCredentials || isBackgroundRefreshing) return;
        
        isBackgroundRefreshing = true;
        console.log('🔄 Background refresh started...');
        
        // Update refresh indicator
        const refreshIndicator = document.getElementById('refreshIndicator');
        const dataMode = document.getElementById('dataMode');
        if (dataMode) {
            dataMode.innerHTML = '🔄 Updating...';
            dataMode.style.color = '#f59e0b';
        }

        try {
            const token = getAuthToken();
            const response = await fetch('/api/dashboard', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify(lastAwsCredentials)
            });

            const data = await response.json();
            
            if (data.success) {
                // Save new analysis to localStorage
                localStorage.setItem('lastAnalysis', JSON.stringify(data));
                
                // Update dashboard with new data instantly
                currentAWSData = data.awsData;
                
                // Remember which section user is currently viewing
                const wasOnDashboard = currentActiveSection === 'dashboard';
                const wasOnAI = currentActiveSection === 'aiAssistant';
                const wasOnHistory = currentActiveSection === 'historicalTrends';
                
                renderDashboard(data);
                
                // Restore the active section after rendering (don't force switch to dashboard)
                if (wasOnDashboard) {
                    document.getElementById('dashboardContent').style.display = 'block';
                    document.getElementById('aiAssistantSection').style.display = 'none';
                    document.getElementById('historicalTrendsSection').style.display = 'none';
                } else if (wasOnAI) {
                    document.getElementById('dashboardContent').style.display = 'none';
                    document.getElementById('aiAssistantSection').style.display = 'block';
                    document.getElementById('historicalTrendsSection').style.display = 'none';
                } else if (wasOnHistory) {
                    document.getElementById('dashboardContent').style.display = 'none';
                    document.getElementById('aiAssistantSection').style.display = 'none';
                    document.getElementById('historicalTrendsSection').style.display = 'block';
                }
                
                // Update instance limits with fresh data
                await loadInstanceLimits();
                
                console.log('✅ Background refresh complete - stayed on', currentActiveSection, 'section');
                
                // Show success indicator briefly
                if (dataMode) {
                    dataMode.innerHTML = '✅ Updated';
                    dataMode.style.color = '#10b981';
                    setTimeout(() => {
                        dataMode.innerHTML = '● Real-Time Data';
                        dataMode.style.color = data.isSimulated ? 'var(--color-warning)' : 'var(--color-success)';
                    }, 2000);
                }
            }
        } catch (error) {
            console.error('Background refresh failed:', error);
            if (dataMode) {
                dataMode.innerHTML = '● Real-Time Data';
                dataMode.style.color = 'var(--color-error)';
            }
        } finally {
            isBackgroundRefreshing = false;
        }
    };

    const refreshAIAdviceOnly = async () => {
        if (!lastAwsCredentials) return;
        
        console.log('Auto-refreshing AI advice only...');
        const refreshButton = document.getElementById('refreshAdvice');
        if (refreshButton) {
            refreshButton.innerHTML = '<i class="fa-solid fa-arrows-rotate fa-spin"></i> Auto-refreshing...';
            refreshButton.disabled = true;
        }

        try {
            const token = getAuthToken();
            const response = await fetch('/api/dashboard', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify(lastAwsCredentials)
            });

            const data = await response.json();
            if (data.success && data.aiAdvice) {
                // Only update AI advice section
                renderAIAdvice(data.aiAdvice);
                console.log('✅ AI advice refreshed successfully');
            }
        } catch (error) {
            console.error('Failed to refresh AI advice:', error);
        } finally {
            if (refreshButton) {
                refreshButton.innerHTML = '<i class="fa-solid fa-arrows-rotate"></i> Refresh';
                refreshButton.disabled = false;
            }
        }
    };

    const startAutoRefresh = () => {
        if (autoRefreshInterval) return; // Already running
        
        console.log('🚀 Auto-refresh started - updating every 30 seconds');
        
        // Start countdown timer (updates every second)
        secondsUntilRefresh = 30;
        countdownInterval = setInterval(updateCountdown, 1000);
        
        // Start auto-refresh (runs every 30 seconds)
        autoRefreshInterval = setInterval(async () => {
            if (hasAnalyzedOnce && lastAwsCredentials) {
                secondsUntilRefresh = 30; // Reset countdown
                await refreshDashboardInBackground();
            }
        }, 30000); // 30 seconds
    };

    const stopAutoRefresh = () => {
        if (autoRefreshInterval) {
            clearInterval(autoRefreshInterval);
            autoRefreshInterval = null;
        }
        if (countdownInterval) {
            clearInterval(countdownInterval);
            countdownInterval = null;
        }
        const nextRefreshEl = document.getElementById('nextRefresh');
        if (nextRefreshEl) {
            nextRefreshEl.textContent = 'Auto-refresh paused';
        }
    };

    // Toggle auto-refresh button
    const toggleBtn = document.getElementById('toggleAutoRefresh');
    let autoRefreshEnabled = true;
    
    if (toggleBtn) {
        toggleBtn.addEventListener('click', () => {
            autoRefreshEnabled = !autoRefreshEnabled;
            
            if (autoRefreshEnabled) {
                toggleBtn.innerHTML = '<i class="fa-solid fa-pause"></i> Pause Auto-Refresh';
                toggleBtn.style.background = '#10b981';
                startAutoRefresh();
                console.log('✅ Auto-refresh resumed');
            } else {
                toggleBtn.innerHTML = '<i class="fa-solid fa-play"></i> Resume Auto-Refresh';
                toggleBtn.style.background = '#6b7280';
                stopAutoRefresh();
                console.log('⏸️ Auto-refresh paused');
            }
        });
    }

    // Store credentials and start auto-refresh after first manual analysis
    const originalAnalyzeAWS = analyzeAWS;
    window.analyzeAWS = async function() {
        const awsAccessKey = document.getElementById('awsAccessKey').value.trim();
        const awsSecretKey = document.getElementById('awsSecretKey').value.trim();
        
        if (awsAccessKey && awsSecretKey) {
            lastAwsCredentials = { awsAccessKey, awsSecretKey };
        }
        
        await originalAnalyzeAWS.apply(this, arguments);
        
        if (!hasAnalyzedOnce) {
            hasAnalyzedOnce = true;
            startAutoRefresh();
            // Show toggle button after first analysis
            if (toggleBtn) {
                toggleBtn.style.display = 'block';
            }
        }
    };

    // Clear sensitive fields on page unload for security
    window.addEventListener('beforeunload', () => {
        const secretKeyField = document.getElementById('awsSecretKey');
        if (secretKeyField) {
            secretKeyField.value = '';
        }
    });
});

// Analyze AWS function
async function analyzeAWS() {
    const awsAccessKey = document.getElementById('awsAccessKey').value.trim();
    const awsSecretKey = document.getElementById('awsSecretKey').value.trim();

    if (!awsAccessKey || !awsSecretKey) {
        showMessage('Input Required', 'Please provide both AWS Access Key and Secret Key.', true);
        return;
    }

    // Note: Credentials will be saved to MongoDB after successful validation by server

    // Show loading
    document.getElementById('loadingState').style.display = 'block';
    document.getElementById('dashboardContent').style.display = 'none';
    
    const button = document.querySelector('#dashboardForm button');
    button.disabled = true;
    document.getElementById('analyzeButtonText').textContent = '🔄 Analyzing...';

    // Simulate progress
    let progress = 0;
    const progressBar = document.getElementById('progressBar');
    const loadingStatus = document.getElementById('loadingStatus');
    
    const progressInterval = setInterval(() => {
        progress += Math.random() * 15;
        if (progress > 90) progress = 90;
        progressBar.style.width = `${progress}%`;
        
        const statuses = [
            'Connecting to AWS...',
            'Fetching EC2 instances...',
            'Analyzing CloudWatch metrics...',
            'Retrieving cost data...',
            'Checking EBS volumes...',
            'Scanning RDS instances...',
            'Generating AI recommendations...'
        ];
        loadingStatus.textContent = statuses[Math.floor(Math.random() * statuses.length)];
    }, 500);

    try {
        const token = getAuthToken();
        
        const response = await fetch('/api/dashboard', {
            method: 'POST',
            headers: { 
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify({ awsAccessKey, awsSecretKey })
        });

        clearInterval(progressInterval);
        progressBar.style.width = '100%';
        loadingStatus.textContent = 'Complete!';

        const data = await response.json();

        if (response.status === 401) {
            if (data.credentialsInvalid) {
                // Invalid AWS credentials
                document.getElementById('loadingState').style.display = 'none';
                showMessage('❌ Invalid AWS Credentials', data.message || 'Please verify your AWS Access Key ID and Secret Access Key are correct.', true);
                return;
            } else {
                // Session expired
                showMessage('Session Expired', 'Your session has expired. Please log in again.', true);
                setTimeout(() => window.logout(), 2000);
                return;
            }
        }

        if (response.status === 403) {
            showMessage('Access Denied', 'Your session has expired. Please log in again.', true);
            setTimeout(() => window.logout(), 2000);
            return;
        }

        if (data.success) {
            // Save analysis to localStorage
            localStorage.setItem('lastAnalysis', JSON.stringify(data));
            
            renderDashboard(data);
            
            // Hide credentials section and show dashboard
            document.getElementById('credentialsSection').style.display = 'none';
            
            const message = data.isSimulated 
                ? 'Analysis complete using demo data. Connect real AWS credentials for live monitoring.'
                : `✅ Real-time AWS data retrieved successfully from Account: ${data.awsData.accountId || 'Your AWS Account'}!`;
                
            setTimeout(() => {
                showMessage('✅ Analysis Complete', message, false);
            }, 500);
        } else {
            document.getElementById('loadingState').style.display = 'none';
            showMessage('Analysis Failed', data.message || 'Could not analyze AWS resources', true);
        }
    } catch (error) {
        clearInterval(progressInterval);
        console.error('Dashboard request failed:', error);
        document.getElementById('loadingState').style.display = 'none';
        showMessage('Connection Error', 'Could not connect to server. Please ensure the backend is running.', true);
    } finally {
        button.disabled = false;
        document.getElementById('analyzeButtonText').innerHTML = '<i class="fa-solid fa-magnifying-glass-chart"></i> Analyze AWS Infrastructure';
    }
}

// Ask Gemini function
async function askGemini() {
    const question = document.getElementById('userQuery').value.trim();
    const useContext = document.getElementById('useContext').checked;
    
    if (!question) {
        showMessage('Input Required', 'Please enter a question.', true);
        return;
    }

    const button = document.getElementById('askButton');
    const buttonText = document.getElementById('askButtonText');
    button.disabled = true;
    buttonText.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Thinking...';

    const responseContainer = document.getElementById('queryResponse');
    responseContainer.style.display = 'block';
    responseContainer.innerHTML = '<p style="text-align: center; color: var(--color-text-secondary);">Analyzing your question...</p>';

    try {
        const token = getAuthToken();
        
        const response = await fetch('/api/gemini-query', {
            method: 'POST',
            headers: { 
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify({ question, context: useContext })
        });

        const data = await response.json();

        if (data.success) {
            // Display plain text response (no markdown rendering)
            const answerText = data.answer
                .replace(/\n\n/g, '</p><p style="margin: 12px 0;">')
                .replace(/\n/g, '<br>');
            
            responseContainer.innerHTML = `
                <div style="background: #E8F5E9; padding: 14px; border-radius: 8px; margin-bottom: 16px; border-left: 4px solid #4CAF50;">
                    <strong style="color: #2E7D32;"><i class="fa-solid fa-user"></i> Your Question:</strong>
                    <div style="margin-top: 8px; color: #1B5E20;">${question}</div>
                </div>
                <div style="background: #F3E5F5; padding: 18px; border-radius: 8px; border-left: 4px solid #9C27B0;">
                    <strong style="color: #6D28D9; margin-bottom: 12px; display: block;"><i class="fa-solid fa-robot"></i> AI Assistant:</strong>
                    <div style="line-height: 1.8; color: #2C3E50; text-align: left; white-space: pre-wrap; font-size: 0.95rem;">
                        <p style="margin: 0 0 12px 0;">${answerText}</p>
                    </div>
                </div>
            `;
        } else {
            responseContainer.innerHTML = `<p style="color: var(--color-error);">${data.message}</p>`;
        }
    } catch (error) {
        console.error('Gemini query failed:', error);
        responseContainer.innerHTML = '<p style="color: var(--color-error);">Failed to get response. Please try again.</p>';
    } finally {
        button.disabled = false;
        buttonText.innerHTML = '<i class="fa-solid fa-paper-plane"></i> Ask AI';
    }
}

// === Navigation Handling ===
function showCredentialsSection() {
    // kept for backwards compatibility — show only credentials
    currentActiveSection = 'credentials';
    document.getElementById('credentialsSection').style.display = 'block';
    document.getElementById('dashboardContent').style.display = 'none';
    document.getElementById('loadingState').style.display = 'none';
    document.getElementById('aiAssistantSection').style.display = 'none';
    document.getElementById('historicalTrendsSection').style.display = 'none';
    document.getElementById('settingsPageSection')?.style.display = 'none';

    // Update nav active state
    document.querySelectorAll('.nav-item').forEach(item => item.classList.remove('active'));
    document.querySelector('#credentialsNavLink').parentElement.classList.add('active');

    // Scroll to top
    window.scrollTo({ top: 0, behavior: 'smooth' });
}

// Load the standalone settings page into the dashboard SPA
async function showSettingsPage() {
    currentActiveSection = 'settings';

    // Hide other sections
    document.getElementById('credentialsSection')?.style.display = 'none';
    document.getElementById('dashboardContent')?.style.display = 'none';
    document.getElementById('loadingState')?.style.display = 'none';
    document.getElementById('aiAssistantSection')?.style.display = 'none';
    document.getElementById('historicalTrendsSection')?.style.display = 'none';

    // Update nav active state
    document.querySelectorAll('.nav-item').forEach(item => item.classList.remove('active'));
    document.querySelector('#credentialsNavLink')?.parentElement.classList.add('active');

    // We'll inject settings into the credentials section's settingsContainer
    const container = document.getElementById('settingsContainer');
    const credentialsSection = document.getElementById('credentialsSection');
    if (!container || !credentialsSection) return;

    // Show credentials section (which now hosts settings)
    credentialsSection.style.display = 'block';

    // If already loaded, just show
    if (container.dataset.loaded === 'true') {
        container.style.display = 'block';
        window.scrollTo({ top: 0, behavior: 'smooth' });
        return;
    }

    try {
        const res = await fetch('/pages/settings.html');
        const text = await res.text();

        // Parse and extract the main content or the settings section
        const parser = new DOMParser();
        const doc = parser.parseFromString(text, 'text/html');
        // Prefer the specific settings section to avoid duplicating headers/nav and conflicting IDs
        const main = doc.querySelector('#cloud-provider-settings') || doc.querySelector('main') || doc.body;

        container.innerHTML = '';
        container.appendChild(main.cloneNode(true));

        // Mark loaded and initialize settings handlers
        container.dataset.loaded = 'true';
        if (typeof initSettings === 'function') initSettings();

        window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (err) {
        console.error('Failed to load settings page:', err);
        showMessage('Error', 'Could not load Settings page. Try opening it directly.', true);
    }
}

function showDashboardSection() {
    currentActiveSection = 'dashboard';
    document.getElementById('credentialsSection').style.display = 'none';
    document.getElementById('loadingState').style.display = 'none';
    document.getElementById('aiAssistantSection').style.display = 'none';
    document.getElementById('historicalTrendsSection').style.display = 'none';
    
    // Check if dashboard has been loaded
    const dashboardContent = document.getElementById('dashboardContent');
    const lastAnalysis = localStorage.getItem('lastAnalysis');
    
    if (lastAnalysis) {
        try {
            const data = JSON.parse(lastAnalysis);
            renderDashboard(data);
            dashboardContent.style.display = 'block';
        } catch (e) {
            console.error('Failed to load last analysis:', e);
            showCredentialsSection();
            return;
        }
    } else {
        // No analysis available, show credentials
        showCredentialsSection();
        return;
    }
    
    // Update nav active state
    document.querySelectorAll('.nav-item').forEach(item => item.classList.remove('active'));
    document.querySelector('#dashboardNavLink').parentElement.classList.add('active');
    
    // Scroll to top
    window.scrollTo({ top: 0, behavior: 'smooth' });
}

function showAIAssistantSection() {
    currentActiveSection = 'aiAssistant';
    document.getElementById('credentialsSection').style.display = 'none';
    document.getElementById('dashboardContent').style.display = 'none';
    document.getElementById('loadingState').style.display = 'none';
    document.getElementById('historicalTrendsSection').style.display = 'none';
    document.getElementById('aiAssistantSection').style.display = 'block';
    
    // Update nav active state
    document.querySelectorAll('.nav-item').forEach(item => item.classList.remove('active'));
    document.querySelector('#aiAssistantNavLink').parentElement.classList.add('active');
    
    // Scroll to top
    window.scrollTo({ top: 0, behavior: 'smooth' });
}

function showHistoricalTrendsSection() {
    currentActiveSection = 'historicalTrends';
    document.getElementById('credentialsSection').style.display = 'none';
    document.getElementById('dashboardContent').style.display = 'none';
    document.getElementById('loadingState').style.display = 'none';
    document.getElementById('aiAssistantSection').style.display = 'none';
    document.getElementById('historicalTrendsSection').style.display = 'block';
    
    // Update nav active state
    document.querySelectorAll('.nav-item').forEach(item => item.classList.remove('active'));
    document.querySelector('#historicalTrendsNavLink').parentElement.classList.add('active');
    
    // Scroll to top
    window.scrollTo({ top: 0, behavior: 'smooth' });
}

// Initialize navigation listeners
document.addEventListener('DOMContentLoaded', () => {
    // Credentials nav link
    const credentialsNavLink = document.getElementById('credentialsNavLink');
    if (credentialsNavLink) {
        credentialsNavLink.addEventListener('click', (e) => {
            e.preventDefault();
            showCredentialsSection();
        });
    }
    
    // Dashboard nav link
    const dashboardNavLink = document.getElementById('dashboardNavLink');
    if (dashboardNavLink) {
        dashboardNavLink.addEventListener('click', (e) => {
            e.preventDefault();
            showDashboardSection();
        });
    }
    
    // AI Assistant nav link
    const aiAssistantNavLink = document.getElementById('aiAssistantNavLink');
    if (aiAssistantNavLink) {
        aiAssistantNavLink.addEventListener('click', (e) => {
            e.preventDefault();
            showAIAssistantSection();
        });
    }
    
    // Historical Trends nav link
    const historicalTrendsNavLink = document.getElementById('historicalTrendsNavLink');
    if (historicalTrendsNavLink) {
        historicalTrendsNavLink.addEventListener('click', (e) => {
            e.preventDefault();
            showHistoricalTrendsSection();
        });
    }
    
    // Back to dashboard button
    const backToDashboard = document.getElementById('backToDashboard');
    if (backToDashboard) {
        backToDashboard.addEventListener('click', (e) => {
            e.preventDefault();
            showDashboardSection();
        });
    }
    
    // Check if user has existing credentials and show dashboard
    const token = localStorage.getItem('authToken');
    if (token) {
        // Try to load last analysis if available
        const lastAnalysis = localStorage.getItem('lastAnalysis');
        if (lastAnalysis) {
            try {
                const data = JSON.parse(lastAnalysis);
                renderDashboard(data);
                document.getElementById('dashboardContent').style.display = 'block';
                document.getElementById('credentialsSection').style.display = 'none';
            } catch (e) {
                // If parsing fails, show credentials section
                showCredentialsSection();
            }
        } else {
            // No last analysis, show credentials
            showCredentialsSection();
        }
    }
});

// ========== INSTANCE LIMIT MANAGEMENT ==========

let instanceMonitoringInterval = null;
let currentAWSData = null;

// Load instance limits and populate the UI
async function loadInstanceLimits() {
    try {
        const token = getAuthToken();
        const response = await fetch('/api/instance-limits', {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        
        const data = await response.json();
        if (data.success) {
            renderInstanceLimits(data.limits);
        }
    } catch (error) {
        console.error('Failed to load instance limits:', error);
    }
}

// Render instance limits in the UI
function renderInstanceLimits(limits) {
    const container = document.getElementById('instanceLimitsList');
    if (!container) return;
    
    if (!currentAWSData || !currentAWSData.ec2Details || currentAWSData.ec2Details.length === 0) {
        container.innerHTML = `
            <div style="text-align: center; padding: 40px; color: #6b7280;">
                <i class="fa-solid fa-info-circle" style="font-size: 2rem; margin-bottom: 12px; display: block;"></i>
                <p>No running instances found. Analyze your AWS infrastructure first.</p>
            </div>
        `;
        return;
    }
    
    container.innerHTML = '';
    
    const runningInstances = currentAWSData.ec2Details.filter(i => i.state === 'running');
    
    if (runningInstances.length === 0) {
        container.innerHTML = `
            <div style="text-align: center; padding: 40px; color: #6b7280;">
                <i class="fa-solid fa-power-off" style="font-size: 2rem; margin-bottom: 12px; display: block;"></i>
                <p>No running instances. Start an instance to enable monitoring.</p>
            </div>
        `;
        return;
    }
    
    runningInstances.forEach(instance => {
        const limit = limits.find(l => l.instanceId === instance.id);
        const metrics = currentAWSData.ec2Metrics?.[instance.id];
        const currentCPU = metrics?.cpu?.average || 0;
        
        const card = document.createElement('div');
        card.style.cssText = 'background: white; border-radius: 12px; padding: 20px; box-shadow: 0 2px 8px rgba(0,0,0,0.08); border-left: 5px solid ' + (limit ? '#10b981' : '#d1d5db');
        
        const instanceName = instance.tags?.Name || 'Unnamed';
        
        card.innerHTML = `
            <div style="display: flex; justify-content: space-between; align-items: start; margin-bottom: 16px;">
                <div>
                    <h3 style="margin: 0 0 6px 0; font-size: 1.1rem; color: #111827;">
                        <i class="fa-solid fa-server"></i> ${instanceName}
                    </h3>
                    <p style="margin: 0; font-size: 0.85rem; color: #6b7280;">
                        ${instance.id} | ${instance.type} | ${instance.az}
                    </p>
                </div>
                <span style="padding: 6px 12px; background: #10b981; color: white; border-radius: 20px; font-size: 0.8rem; font-weight: 600;">
                    <i class="fa-solid fa-circle-check"></i> Running
                </span>
            </div>
            
            <div style="display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 16px; margin-bottom: 16px;">
                <div style="text-align: center; padding: 12px; background: #f3f4f6; border-radius: 8px;">
                    <div style="font-size: 0.75rem; color: #6b7280; margin-bottom: 4px;">CURRENT CPU</div>
                    <div style="font-size: 1.5rem; font-weight: 700; color: ${currentCPU > (limit?.cpuLimit || 100) ? '#ef4444' : '#10b981'};">
                        ${currentCPU.toFixed(1)}%
                    </div>
                </div>
                <div style="text-align: center; padding: 12px; background: #f3f4f6; border-radius: 8px;">
                    <div style="font-size: 0.75rem; color: #6b7280; margin-bottom: 4px;">CPU LIMIT</div>
                    <div style="font-size: 1.5rem; font-weight: 700; color: #f59e0b;">
                        ${limit ? limit.cpuLimit + '%' : 'Not Set'}
                    </div>
                </div>
                <div style="text-align: center; padding: 12px; background: #f3f4f6; border-radius: 8px;">
                    <div style="font-size: 0.75rem; color: #6b7280; margin-bottom: 4px;">STATUS</div>
                    <div style="font-size: 0.9rem; font-weight: 600; color: ${limit && currentCPU > limit.cpuLimit ? '#ef4444' : '#10b981'};">
                        ${limit && currentCPU > limit.cpuLimit ? '⚠️ OVER LIMIT' : '✓ Normal'}
                    </div>
                </div>
            </div>
            
            ${limit ? `
                <div style="padding: 12px; background: #ecfdf5; border-radius: 8px; margin-bottom: 12px;">
                    <div style="font-size: 0.85rem; color: #047857;">
                        <strong>🛡️ Protection Active:</strong> Auto-shutdown after 30s if CPU > ${limit.cpuLimit}%
                    </div>
                </div>
            ` : ''}
            
            <div style="display: flex; gap: 8px; justify-content: flex-end;">
                ${limit ? `
                    <button onclick="removeInstanceLimit('${instance.id}')" style="padding: 8px 16px; background: #ef4444; color: white; border: none; border-radius: 6px; cursor: pointer; font-size: 0.85rem; font-weight: 600;">
                        <i class="fa-solid fa-trash"></i> Remove Limit
                    </button>
                ` : ''}
            </div>
        `;
        
        container.appendChild(card);
    });
    
    // Populate instance select dropdown
    populateInstanceSelect(runningInstances);
}

// Populate instance select dropdown
function populateInstanceSelect(instances) {
    const select = document.getElementById('instanceSelect');
    if (!select) return;
    
    select.innerHTML = '<option value="">-- Select Instance --</option>';
    
    instances.forEach(instance => {
        const name = instance.tags?.Name || 'Unnamed';
        const option = document.createElement('option');
        option.value = instance.id;
        option.textContent = `${name} (${instance.id} - ${instance.type})`;
        select.appendChild(option);
    });
}

// Set instance limit
async function setInstanceLimit(instanceId, cpuLimit) {
    try {
        const token = getAuthToken();
        const response = await fetch('/api/instance-limits', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify({ instanceId, cpuLimit, autoShutdown: true })
        });
        
        const data = await response.json();
        if (data.success) {
            showMessage('✅ Limit Set', `CPU limit of ${cpuLimit}% set for instance ${instanceId}`, false);
            await loadInstanceLimits();
            startInstanceMonitoring();
        } else {
            showMessage('Error', data.message, true);
        }
    } catch (error) {
        showMessage('Error', 'Failed to set instance limit', true);
    }
}

// Remove instance limit
window.removeInstanceLimit = async function(instanceId) {
    if (!confirm(`Remove CPU limit for instance ${instanceId}?`)) return;
    
    try {
        const token = getAuthToken();
        const response = await fetch(`/api/instance-limits/${instanceId}`, {
            method: 'DELETE',
            headers: { 'Authorization': `Bearer ${token}` }
        });
        
        const data = await response.json();
        if (data.success) {
            showMessage('✅ Limit Removed', `CPU limit removed for instance ${instanceId}`, false);
            await loadInstanceLimits();
        }
    } catch (error) {
        showMessage('Error', 'Failed to remove limit', true);
    }
};

// Monitor instances and trigger auto-shutdown
async function monitorInstances() {
    if (!currentAWSData || !currentAWSData.ec2Details) return;
    
    const awsAccessKey = document.getElementById('awsAccessKey')?.value.trim();
    const awsSecretKey = document.getElementById('awsSecretKey')?.value.trim();
    
    if (!awsAccessKey || !awsSecretKey) return;
    
    const token = getAuthToken();
    const runningInstances = currentAWSData.ec2Details.filter(i => i.state === 'running');
    
    for (const instance of runningInstances) {
        const metrics = currentAWSData.ec2Metrics?.[instance.id];
        if (!metrics) continue;
        
        const currentCPU = metrics.cpu.average;
        
        try {
            const response = await fetch('/api/monitor-instance', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify({
                    instanceId: instance.id,
                    currentCPU,
                    awsAccessKey,
                    awsSecretKey
                })
            });
            
            const data = await response.json();
            
            if (data.action === 'alert') {
                showAlert(instance, data);
            } else if (data.action === 'countdown') {
                showCountdown(instance, data);
            } else if (data.action === 'stopped') {
                showInstanceStopped(instance, data);
                // Refresh dashboard after stopping
                setTimeout(() => analyzeAWS(), 3000);
            }
        } catch (error) {
            console.error('Monitor error:', error);
        }
    }
}

// Show alert banner
function showAlert(instance, data) {
    const banner = document.getElementById('activeAlertsBanner');
    const messages = document.getElementById('alertMessages');
    
    if (!banner || !messages) return;
    
    const instanceName = instance.tags?.Name || instance.id;
    messages.innerHTML = `
        <div style="padding: 12px; background: white; border-radius: 8px; margin-bottom: 8px;">
            <strong style="color: #dc2626; font-size: 1.05rem;">Instance: ${instanceName} (${instance.id})</strong><br>
            <span style="color: #991b1b;">Current CPU: <strong>${data.currentCPU.toFixed(1)}%</strong> | Limit: <strong>${data.limit}%</strong></span><br>
            <span style="color: #7f1d1d; font-weight: 600;">⏱️ Auto-shutdown in ${data.shutdownIn} seconds...</span>
        </div>
    `;
    
    // Apply enhanced animation classes
    banner.classList.add('alert-active', 'alert-glow', 'alert-enter');
    banner.style.display = 'block';
}

// Show countdown
function showCountdown(instance, data) {
    const banner = document.getElementById('activeAlertsBanner');
    const messages = document.getElementById('alertMessages');
    
    if (!banner || !messages) return;
    
    const instanceName = instance.tags?.Name || instance.id;
    messages.innerHTML = `
        <div style="padding: 12px; background: white; border-radius: 8px; margin-bottom: 8px;">
            <strong style="color: #dc2626; font-size: 1.05rem;">Instance: ${instanceName} (${instance.id})</strong><br>
            <span style="color: #991b1b;">Current CPU: <strong>${data.currentCPU.toFixed(1)}%</strong> | Limit: <strong>${data.limit}%</strong></span><br>
            <span style="color: #7f1d1d; font-weight: 600;">⏱️ Shutting down in ${data.remainingSeconds} seconds...</span>
            <div style="margin-top: 8px; height: 8px; background: #fee2e2; border-radius: 4px; overflow: hidden;">
                <div class="countdown-bar-active" style="height: 100%; background: #dc2626; width: ${(30 - data.remainingSeconds) / 30 * 100}%; transition: width 1s;"></div>
            </div>
        </div>
    `;
    
    // Maintain alert animations and add countdown pulse to progress bar
    banner.classList.add('alert-active', 'alert-glow');
    banner.style.display = 'block';
}

// Show instance stopped message
function showInstanceStopped(instance, data) {
    const banner = document.getElementById('activeAlertsBanner');
    const messages = document.getElementById('alertMessages');
    
    if (!banner || !messages) return;
    
    const instanceName = instance.tags?.Name || instance.id;
    messages.innerHTML = `
        <div style="padding: 16px; background: #dcfce7; border: 2px solid #10b981; border-radius: 8px;">
            <strong style="color: #047857; font-size: 1.1rem;">✅ Instance Automatically Stopped</strong><br>
            <span style="color: #065f46;">Instance: <strong>${instanceName} (${instance.id})</strong></span><br>
            <span style="color: #065f46;">Reason: ${data.reason}</span><br>
            <span style="color: #047857; font-weight: 600;">AWS Status: ${data.currentState}</span><br>
            <span style="font-size: 0.85rem; color: #059669;">Dashboard will refresh automatically...</span>
        </div>
    `;
    
    // Remove danger alert animations and show success state
    banner.classList.remove('alert-active', 'alert-glow', 'alert-enter');
    banner.style.display = 'block';
    banner.style.background = '#d1fae5';
    banner.style.borderColor = '#10b981';
    
    // Save to auto-stopped history
    saveAutoStoppedInstance({
        instanceId: instance.id,
        instanceName: instanceName,
        instanceType: instance.type,
        stoppedAt: new Date().toISOString(),
        reason: data.reason,
        cpuAtStop: data.currentCPU,
        cpuLimit: data.limit
    });
    
    setTimeout(() => {
        banner.style.display = 'none';
        renderAutoStoppedHistory();
    }, 10000);
}

// Save auto-stopped instance to localStorage
function saveAutoStoppedInstance(instanceData) {
    let history = JSON.parse(localStorage.getItem('autoStoppedHistory') || '[]');
    history.unshift(instanceData); // Add to beginning
    history = history.slice(0, 10); // Keep only last 10
    localStorage.setItem('autoStoppedHistory', JSON.stringify(history));
    console.log('📝 Auto-stopped instance saved to history:', instanceData);
}

// Render auto-stopped instances history
function renderAutoStoppedHistory() {
    const container = document.getElementById('autoStoppedHistory');
    if (!container) return;
    
    const history = JSON.parse(localStorage.getItem('autoStoppedHistory') || '[]');
    const recentTwo = history.slice(0, 2);
    
    if (recentTwo.length === 0) {
        container.innerHTML = `
            <div style="text-align: center; padding: 40px; color: #6b7280; grid-column: 1 / -1;">
                <i class="fa-solid fa-info-circle" style="font-size: 2rem; margin-bottom: 12px; display: block;"></i>
                <p>No instances have been auto-stopped yet</p>
            </div>
        `;
        return;
    }
    
    container.innerHTML = '';
    
    recentTwo.forEach((item, index) => {
        const stoppedDate = new Date(item.stoppedAt);
        const timeAgo = getTimeAgo(stoppedDate);
        
        const card = document.createElement('div');
        card.style.cssText = 'background: white; border-radius: 12px; padding: 20px; box-shadow: 0 2px 8px rgba(0,0,0,0.08); border-left: 5px solid #ef4444;';
        
        card.innerHTML = `
            <div style="display: flex; justify-content: between; align-items: start; margin-bottom: 16px;">
                <div style="flex: 1;">
                    <h4 style="margin: 0 0 8px 0; font-size: 1rem; color: #111827;">
                        <i class="fa-solid fa-server"></i> ${item.instanceName}
                    </h4>
                    <p style="margin: 0 0 4px 0; font-size: 0.85rem; color: #6b7280;">
                        ${item.instanceId} | ${item.instanceType}
                    </p>
                    <p style="margin: 0; font-size: 0.8rem; color: #9ca3af;">
                        <i class="fa-solid fa-clock"></i> ${stoppedDate.toLocaleString()} (${timeAgo})
                    </p>
                </div>
            </div>
            
            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-bottom: 12px;">
                <div style="text-align: center; padding: 10px; background: #fef2f2; border-radius: 8px;">
                    <div style="font-size: 0.7rem; color: #991b1b; margin-bottom: 2px; font-weight: 600;">CPU AT STOP</div>
                    <div style="font-size: 1.3rem; font-weight: 700; color: #ef4444;">${item.cpuAtStop?.toFixed(1) || 'N/A'}%</div>
                </div>
                <div style="text-align: center; padding: 10px; background: #fef3c7; border-radius: 8px;">
                    <div style="font-size: 0.7rem; color: #92400e; margin-bottom: 2px; font-weight: 600;">CPU LIMIT</div>
                    <div style="font-size: 1.3rem; font-weight: 700; color: #f59e0b;">${item.cpuLimit || 'N/A'}%</div>
                </div>
            </div>
            
            <div style="padding: 10px; background: #f3f4f6; border-radius: 8px; margin-bottom: 12px;">
                <div style="font-size: 0.8rem; color: #374151;">
                    <strong>Reason:</strong> ${item.reason || 'CPU limit exceeded'}
                </div>
            </div>
            
            <canvas id="stopChart${index}" style="width: 100%; height: 80px;"></canvas>
        `;
        
        container.appendChild(card);
        
        // Render mini area chart
        setTimeout(() => renderStopChart(index, item), 100);
    });
}

// Render mini area chart for stopped instance
function renderStopChart(index, data) {
    const canvas = document.getElementById(`stopChart${index}`);
    if (!canvas) return;
    
    const ctx = canvas.getContext('2d');
    
    // Simulate CPU trend before stop (decreasing from high to limit exceeded)
    const cpuTrend = [];
    const limit = data.cpuLimit || 50;
    const finalCpu = data.cpuAtStop || limit + 20;
    
    for (let i = 0; i < 20; i++) {
        if (i < 12) {
            cpuTrend.push(Math.random() * 30 + 20); // Normal range
        } else {
            // Gradual increase to exceed limit
            const progress = (i - 12) / 8;
            cpuTrend.push(limit + (finalCpu - limit) * progress);
        }
    }
    
    new Chart(ctx, {
        type: 'line',
        data: {
            labels: Array(20).fill(''),
            datasets: [{
                label: 'CPU Usage',
                data: cpuTrend,
                borderColor: '#ef4444',
                backgroundColor: 'rgba(239, 68, 68, 0.15)',
                borderWidth: 2,
                fill: true,
                tension: 0.4,
                pointRadius: 0,
                pointHoverRadius: 4
            }, {
                label: 'Limit',
                data: Array(20).fill(limit),
                borderColor: '#f59e0b',
                borderWidth: 2,
                borderDash: [5, 5],
                fill: false,
                pointRadius: 0
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: false },
                tooltip: { enabled: false }
            },
            scales: {
                x: { display: false },
                y: { 
                    display: true,
                    min: 0,
                    max: 100,
                    ticks: {
                        font: { size: 9 },
                        color: '#6b7280'
                    },
                    grid: { color: '#e5e7eb' }
                }
            }
        }
    });
}

// Helper function for time ago
function getTimeAgo(date) {
    const seconds = Math.floor((new Date() - date) / 1000);
    
    if (seconds < 60) return `${seconds}s ago`;
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    return `${days}d ago`;
}

// Start monitoring
function startInstanceMonitoring() {
    if (instanceMonitoringInterval) {
        clearInterval(instanceMonitoringInterval);
    }
    
    // Monitor every 5 seconds
    instanceMonitoringInterval = setInterval(monitorInstances, 5000);
    console.log('✅ Instance monitoring started');
}

// Stop monitoring
function stopInstanceMonitoring() {
    if (instanceMonitoringInterval) {
        clearInterval(instanceMonitoringInterval);
        instanceMonitoringInterval = null;
        console.log('⏸️  Instance monitoring stopped');
    }
}

// Initialize limit management
document.addEventListener('DOMContentLoaded', () => {
    // Set limit form
    const setLimitForm = document.getElementById('setLimitForm');
    if (setLimitForm) {
        setLimitForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const instanceId = document.getElementById('instanceSelect').value;
            const cpuLimit = document.getElementById('cpuLimitInput').value;
            
            if (!instanceId) {
                showMessage('Error', 'Please select an instance', true);
                return;
            }
            
            await setInstanceLimit(instanceId, cpuLimit);
            setLimitForm.reset();
        });
    }
    
    // Refresh limits button - trigger new AWS analysis
    const refreshLimitsBtn = document.getElementById('refreshLimitsBtn');
    if (refreshLimitsBtn) {
        refreshLimitsBtn.addEventListener('click', async () => {
            // Get AWS credentials from form fields
            const awsAccessKey = document.getElementById('awsAccessKey')?.value.trim();
            const awsSecretKey = document.getElementById('awsSecretKey')?.value.trim();

            if (!awsAccessKey || !awsSecretKey) {
                showMessage('Credentials Required', 'Please enter your AWS credentials first in the Credentials section.', true);
                // Navigate to credentials section
                showCredentialsSection();
                return;
            }

            // Add visual feedback
            refreshLimitsBtn.disabled = true;
            refreshLimitsBtn.innerHTML = '<i class="fa-solid fa-sync fa-spin"></i> Refreshing...';

            try {
                // Trigger new AWS analysis
                await analyzeAWS();
            } catch (error) {
                console.error('Refresh error:', error);
                showMessage('Error', 'Failed to refresh AWS data', true);
            } finally {
                refreshLimitsBtn.disabled = false;
                refreshLimitsBtn.innerHTML = '<i class="fa-solid fa-sync"></i> Refresh';
            }
        });
    }
});

// Hook into the existing renderDashboard function to store AWS data
const originalRenderDashboard = window.renderDashboard || renderDashboard;
window.renderDashboard = function(data) {
    currentAWSData = data.awsData;
    originalRenderDashboard(data);
    
    // Load limits after rendering
    setTimeout(() => {
        loadInstanceLimits();
        startInstanceMonitoring();
    }, 1000);
};
