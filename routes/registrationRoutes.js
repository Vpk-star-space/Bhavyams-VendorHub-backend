const express = require('express');
const router = express.Router();
const axios = require('axios');
require('dotenv').config();

const BREVO_API_URL = 'https://api.brevo.com/v3/smtp/email';
const API_KEY = process.env.BREVO_API_KEY; 
const SENDER_EMAIL = process.env.EMAIL_USER; 

// POST Route for Local Business Registration
router.post('/register-interest', async (req, res) => {
    try {
        // 1. Get the data from the frontend form
        const { name, phone, businessName, products, location, email } = req.body;

        // 2. Validate required fields
        if (!name || !phone || !businessName || !products || !location) {
            return res.status(400).json({ message: "Please fill all required fields." });
        }

        // 3. Prepare the email content for YOU
        const emailHtml = `
            <h2>🚀 New Local Business Registration - subhams-hub Hub</h2>
            <p><strong>Name:</strong> ${name}</p>
            <p><strong>Phone (WhatsApp):</strong> ${phone}</p>
            <p><strong>Business Name:</strong> ${businessName}</p>
            <p><strong>Products/Services:</strong> ${products}</p>
            <p><strong>Location:</strong> ${location}</p>
            <p><strong>Email:</strong> ${email || 'Not provided'}</p>
            <br/>
            <p><i>Log in to your WhatsApp and message them to onboard them!</i></p>
        `;

        // 4. Set up the Brevo API payload
        const emailData = {
            sender: { name: "subhams-hub Hub System", email: SENDER_EMAIL },
            to: [{ email: "pavanvenkat63@gmail.com", name: "Venkata Pavan Kumar" }],
            subject: "🔔 New Vendor Registration - subhams-hub",
            htmlContent: emailHtml
        };

        // 5. Send the email using Brevo
        await axios.post(BREVO_API_URL, emailData, {
            headers: {
                'accept': 'application/json',
                'api-key': API_KEY,
                'content-type': 'application/json'
            }
        });

        // 6. Send success response back to frontend
        res.status(200).json({ message: "Registration successful! Email sent." });

    } catch (error) {
        console.error("Error sending registration email:", error.response?.data || error.message);
        res.status(500).json({ message: "Failed to submit registration. Please try again." });
    }
});

module.exports = router;