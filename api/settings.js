
module.exports = (req, res) => {
    if (req.method === 'POST') {
        console.log('Received settings:', req.body);
        res.status(200).json({ message: 'Settings saved successfully!' });
    } else {
        res.status(405).json({ message: 'Method Not Allowed' });
    }
};
