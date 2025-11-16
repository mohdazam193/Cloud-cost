// Utility function for custom modal/alert replacement
function showMessage(title, message, isError = false) {
    const modal = document.getElementById('messageModal');
    const modalTitle = document.getElementById('modalTitle');
    const modalMessage = document.getElementById('modalMessage');
    const modalOkButton = document.getElementById('modalOkButton');

    modalTitle.textContent = title;
    modalMessage.textContent = message;

    // Apply color theme based on error status
    modalTitle.style.color = isError ? 'var(--color-error)' : 'var(--color-primary)';
    
    modalOkButton.onclick = () => {
        modal.style.display = 'none';
        if (title === 'Login Successful') {
            window.location.href = '/pages/dashboard.html';
        }
    };
    
    modal.style.display = 'block';
}

// Loading indicator
function showLoading(show = true) {
    const buttons = document.querySelectorAll('button[type="submit"]');
    buttons.forEach(btn => {
        if (show) {
            btn.disabled = true;
            btn.dataset.originalText = btn.textContent;
            btn.textContent = 'Loading...';
        } else {
            btn.disabled = false;
            btn.textContent = btn.dataset.originalText || btn.textContent;
        }
    });
}

document.addEventListener('DOMContentLoaded', () => {
    const loginForm = document.getElementById('loginForm');
    if (loginForm) {
        loginForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            
            const username = document.getElementById('username').value.trim();
            const password = document.getElementById('password').value;

            if (!username || !password) {
                showMessage('Validation Error', 'Please enter both username and password', true);
                return;
            }

            showLoading(true);

            try {
                const response = await fetch('/api/login', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ username, password })
                });

                const data = await response.json();

                if (data.success) {
                    // Store JWT token and username
                    localStorage.setItem('authToken', data.token);
                    localStorage.setItem('username', data.username);
                    showMessage('Login Successful', `Welcome back, ${data.username}! Redirecting to dashboard...`, false);
                    
                    // Redirect after short delay
                    setTimeout(() => {
                        window.location.href = '/pages/dashboard.html';
                    }, 1500);
                } else {
                    showMessage('Login Failed', data.message || 'Invalid credentials', true);
                }
            } catch (error) {
                console.error('Login request failed:', error);
                showMessage('Connection Error', 'Could not connect to the server. Please ensure the backend is running.', true);
            } finally {
                showLoading(false);
            }
        });
    }

    // Function to handle logout
    window.logout = async function() {
        // Clear all local storage
        localStorage.removeItem('authToken');
        localStorage.removeItem('username');
        localStorage.removeItem('awsCredentials');
        localStorage.removeItem('lastAnalysis');
        localStorage.removeItem('autoStoppedHistory');
        
        // Note: We keep credentials in MongoDB so user can access them on next login
        // Each user's credentials are isolated by userId in the database
        
        window.location.href = '/pages/index.html';
    }

    // Check if already logged in (for index page)
    if (window.location.pathname.includes('index.html') || window.location.pathname === '/') {
        const token = localStorage.getItem('authToken');
        if (token && loginForm) {
            // User is already logged in, redirect to dashboard
            window.location.href = '/pages/dashboard.html';
        }
    }
});
