document.addEventListener('DOMContentLoaded', () => {
    const formElements = {
        form: document.getElementById('signupForm'),
        username: document.getElementById('username'),
        password: document.getElementById('password'),
        confirmPassword: document.getElementById('confirmPassword'),
        signupBtn: document.getElementById('signupBtn'),
        successMsg: document.getElementById('successMessage'),
        errors: {
            username: document.getElementById('usernameError'),
            password: document.getElementById('passwordError'),
            confirmPassword: document.getElementById('confirmPasswordError'),
        }
    };

    const errorMsgs = {
        username: {
            min: 'Username must be at least 3 characters',
            max: 'Username must be less than 20 characters',
            pattern: 'Username can only contain letters, numbers, and underscores'
        },
        password: {
            min: 'Password must be at least 6 characters',
            max: 'Password is too long'
        },
        confirmPassword: {
            empty: 'Please confirm your password',
            mismatch: 'Passwords do not match'
        }
    };

    const showError = (field, msg) => {
        const errorEl = formElements.errors[field];
        errorEl.textContent = msg;
        errorEl.classList.add('show');
        formElements[field].classList.add('error');
    };

    const hideError = (field) => {
        const errorEl = formElements.errors[field];
        errorEl.textContent = '';
        errorEl.classList.remove('show');
        formElements[field].classList.remove('error');
    };

    const validateField = (field) => {
        const val = formElements[field].value.trim();
        switch(field) {
            case 'username':
                if (val.length < 3) return showError(field, errorMsgs.username.min);
                if (val.length > 20) return showError(field, errorMsgs.username.max);
                if (!/^\w+$/.test(val)) return showError(field, errorMsgs.username.pattern);
                break;
            case 'password':
                if (val.length < 6) return showError(field, errorMsgs.password.min);
                if (val.length > 100) return showError(field, errorMsgs.password.max);
                break;
            case 'confirmPassword':
                if (!val) return showError(field, errorMsgs.confirmPassword.empty);
                if (val !== formElements.password.value) return showError(field, errorMsgs.confirmPassword.mismatch);
                break;
        }
        hideError(field);
        return true;
    };

    // Validate on blur
    ['username', 'password', 'confirmPassword'].forEach(field => {
        formElements[field].addEventListener('blur', () => validateField(field));
    });

    // Form submit
    formElements.form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const isValid = ['username', 'password', 'confirmPassword']
                        .every(field => validateField(field));
        if (!isValid) return;

        formElements.signupBtn.disabled = true;
        formElements.signupBtn.textContent = 'Creating Account...';

        try {
            const payload = {
                username: formElements.username.value.trim(),
                password: formElements.password.value
            };
            const res = await fetch('/api/register', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
            const data = await res.json();

            if (res.ok && data.success) {
                formElements.successMsg.classList.add('show');
                formElements.form.reset();
                console.log('✅ Sign Up Successfully', data.message);
                setTimeout(() => window.location.href = '/pages/index.html', 2000);
            } else {
                const err = data.error || data.message || 'Signup failed';
                if (err.toLowerCase().includes('username')) showError('username', err);
                else if (err.toLowerCase().includes('password')) showError('password', err);
                else alert('Signup failed: ' + err);
                formElements.signupBtn.disabled = false;
                formElements.signupBtn.textContent = 'Create Account';
            }
        } catch (err) {
            console.error('Signup error:', err);
            alert('Network error');
            formElements.signupBtn.disabled = false;
            formElements.signupBtn.textContent = 'Create Account';
        }
    });
});
