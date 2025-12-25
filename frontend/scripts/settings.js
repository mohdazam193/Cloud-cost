document.addEventListener('DOMContentLoaded', () => {
    const awsEnabledCheckbox = document.getElementById('aws-enabled');
    const azureEnabledCheckbox = document.getElementById('azure-enabled');
    const awsCredentialsDiv = document.getElementById('aws-credentials');
    const azureCredentialsDiv = document.getElementById('azure-credentials');
    const settingsForm = document.getElementById('cloud-settings-form');

    // Function to toggle credential fields
    const toggleCredentials = () => {
        awsCredentialsDiv.style.display = awsEnabledCheckbox.checked ? 'block' : 'none';
        azureCredentialsDiv.style.display = azureEnabledCheckbox.checked ? 'block' : 'none';
    };

    // Initial check
    toggleCredentials();

    // Add event listeners
    awsEnabledCheckbox.addEventListener('change', toggleCredentials);
    azureEnabledCheckbox.addEventListener('change', toggleCredentials);

    // Handle form submission
    settingsForm.addEventListener('submit', async (event) => {
        event.preventDefault();

        const settings = {
            aws: {
                enabled: awsEnabledCheckbox.checked,
                accessKeyId: document.getElementById('aws-access-key-id').value,
                secretAccessKey: document.getElementById('aws-secret-access-key').value,
                region: document.getElementById('aws-region').value,
            },
            azure: {
                enabled: azureEnabledCheckbox.checked,
                clientId: document.getElementById('azure-client-id').value,
                clientSecret: document.getElementById('azure-client-secret').value,
                tenantId: document.getElementById('azure-tenant-id').value,
                subscriptionId: document.getElementById('azure-subscription-id').value,
            },
        };

        try {
            const response = await fetch('/api/settings', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${localStorage.getItem('token')}` // Assuming you store JWT in localStorage
                },
                body: JSON.stringify(settings),
            });

            if (response.ok) {
                alert('Settings saved successfully!');
            } else {
                const error = await response.json();
                alert(`Error saving settings: ${error.message}`);
            }
        } catch (error) {
            console.error('Failed to save settings:', error);
            alert('An error occurred while saving settings.');
        }
    });
});
