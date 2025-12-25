const express = require('express');
const router = express.Router();
const awsService = require('../services/awsService');
const azureService = require('../services/azureService');
const fs = require('fs');

router.post('/costs', async (req, res) => {
  const { cloudProvider } = req.body; // 'aws' or 'azure'

  try {
    let costs;
    if (cloudProvider === 'aws') {
      costs = await awsService.fetchCosts(req.body);
    } else if (cloudProvider === 'azure') {
      costs = await azureService.fetchCosts(req.body);
    } else {
      return res.status(400).json({ success: false, message: 'Invalid cloud provider.' });
    }
    res.json({ success: true, costs });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

router.post('/lambda-data', (req, res) => {
  const data = req.body;
  // Append data to a file for simplicity.
  // In a real application, you would process and store this in a database.
  fs.appendFile('lambda_data.log', JSON.stringify(data) + '\n', (err) => {
    if (err) {
      console.error('Error saving lambda data:', err);
      return res.status(500).send('Error saving data');
    }
    res.status(200).send('Data received');
  });
});

module.exports = router;
