const axios = require('axios');
require('dotenv').config();

const BREVO_API_URL = 'https://api.brevo.com/v3/smtp/email';
const API_KEY = process.env.BREVO_API_KEY; 
const SENDER_EMAIL = process.env.EMAIL_USER; // Pulls pavanvenkat63@gmail.com from Render
const frontendUrl = process.env.FRONTEND_URL || 'https://bhavyams-vendor-hub-vpk.vercel.app';

// 🎨 PREMIUM EMAIL HEADER
const emailHeader = `
    <div style="background-color: #2874f0; padding: 25px; text-align: center; border-radius: 8px 8px 0 0;">
        <h1 style="color: #ffffff; margin: 0; font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif; font-style: italic; font-size: 32px; letter-spacing: 1px;">
            Bhavyams <span style="font-weight: 300;">Hub</span>
        </h1>
        <p style="color: #e0e7ff; margin: 5px 0 0 0; font-size: 12px; letter-spacing: 2px; text-transform: uppercase;">Official Vendor Network</p>
    </div>
`;

const emailFooter = `
    <div style="background-color: #f8fafc; padding: 20px; text-align: center; border-radius: 0 0 8px 8px; border-top: 1px solid #e2e8f0; margin-top: 20px;">
        <p style="color: #64748b; font-size: 12px; margin: 0;">System Engineered by Venkata Pavan Kumar</p>
        <p style="color: #94a3b8; font-size: 10px; margin-top: 5px;">&copy; 2026 Bhavyams VendorHub. All Rights Reserved.</p>
    </div>
`;

// 📧 CORE API SENDER (Bypasses Singapore Port Blocks)
const sendEmailViaAPI = async (to, subject, htmlContent) => {
    try {
        await axios.post(BREVO_API_URL, {
            sender: { name: "Bhavyams Hub", email: SENDER_EMAIL },
            to: [{ email: to }],
            subject: subject,
            htmlContent: htmlContent
        }, {
            headers: { 
                'api-key': API_KEY, 
                'Content-Type': 'application/json' 
            }
        });
        console.log(`✅ Success: Email sent to ${to}`);
    } catch (error) {
        console.error("❌ Brevo API Error:", error.response?.data || error.message);
    }
};

// 📧 1. SEND OTP EMAIL
const sendOTPEmail = async (userEmail, otp) => {
    const html = `
        <div style="max-width: 500px; margin: auto; font-family: Arial, sans-serif; border: 1px solid #e2e8f0; border-radius: 10px;">
            ${emailHeader}
            <div style="padding: 30px; text-align: center; background-color: #ffffff;">
                <h2 style="color: #1e293b;">Account Verification</h2>
                <p style="color: #475569;">Use the code below to securely sign in to your account.</p>
                <div style="background: #f1f3f6; padding: 20px; border-radius: 8px; margin: 25px 0; font-size: 32px; font-weight: bold; color: #2874f0; letter-spacing: 8px;">
                    ${otp}
                </div>
                <p style="color: #94a3b8; font-size: 12px;">This code will expire in 10 minutes.</p>
            </div>
            ${emailFooter}
        </div>`;
    return sendEmailViaAPI(userEmail, `Your Verification Code: ${otp}`, html);
};

// 📧 2. SEND ORDER CONFIRMATION
const sendOrderEmail = async (userEmail, orderDetails) => {
    const { order_id, product_name, total_price, image_url } = orderDetails;
    
    const rawUrl = image_url || '';
    const cleanImg = rawUrl.replace(/["\\]/g, '').startsWith('http') 
        ? rawUrl.replace(/["\\]/g, '') 
        : `https://bhavyams-vendorhub-backend.onrender.com${rawUrl.replace(/["\\]/g, '')}`;

    const html = `
        <div style="max-width: 600px; margin: auto; font-family: Arial, sans-serif; border: 1px solid #e2e8f0; border-radius: 10px;">
            ${emailHeader}
            <div style="padding: 30px; background-color: #ffffff;">
                <h2 style="color: #16a34a; margin-top: 0;">Woohoo! Order Confirmed ✅</h2>
                <p style="color: #475569;">Hi there, your order <b>#${order_id}</b> has been successfully placed.</p>
                <table style="width: 100%; border-collapse: collapse; margin: 20px 0; border: 1px solid #f1f5f9;">
                    <tr>
                        <td style="padding: 15px; width: 100px;">
                            <img src="${cleanImg}" width="80" style="border-radius: 4px; border: 1px solid #eee;" alt="product"/>
                        </td>
                        <td style="padding: 15px;">
                            <div style="font-weight: bold; color: #0f172a; font-size: 16px;">${product_name}</div>
                            <div style="color: #2874f0; font-weight: bold; font-size: 18px; margin-top: 5px;">₹${total_price}</div>
                        </td>
                    </tr>
                </table>
                <div style="text-align: center; margin-top: 30px;">
                    <a href="${frontendUrl}/dashboard" style="background-color: #fb641b; color: white; padding: 12px 30px; text-decoration: none; font-weight: bold; border-radius: 3px; display: inline-block;">TRACK YOUR ORDER</a>
                </div>
            </div>
            ${emailFooter}
        </div>`;
    return sendEmailViaAPI(userEmail, `Order Confirmed! #${order_id}`, html);
};

// 📧 3. SEND DELIVERY NOTIFICATION
const sendDeliveryEmail = async (userEmail, orderDetails) => {
    const { order_id, product_name, image_url } = orderDetails;
    
    const rawUrl = image_url || '';
    const cleanImg = rawUrl.replace(/["\\]/g, '').startsWith('http') 
        ? rawUrl.replace(/["\\]/g, '') 
        : `https://bhavyams-vendorhub-backend.onrender.com${rawUrl.replace(/["\\]/g, '')}`;

    const html = `
        <div style="max-width: 600px; margin: auto; font-family: Arial, sans-serif; border: 1px solid #e2e8f0; border-radius: 10px;">
            ${emailHeader}
            <div style="padding: 30px; text-align: center; background-color: #ffffff;">
                <h2 style="color: #2874f0;">Your order is delivered! 🏠</h2>
                <img src="${cleanImg}" width="150" style="margin: 20px auto; display: block; border-radius: 8px;" />
                <p style="color: #475569; font-size: 16px;">We hope you are loving your new <b>${product_name}</b>!</p>
                <div style="margin-top: 30px;">
                    <a href="${frontendUrl}/dashboard" style="background-color: #2874f0; color: white; padding: 12px 30px; text-decoration: none; font-weight: bold; border-radius: 3px; display: inline-block;">RATE PRODUCT</a>
                </div>
            </div>
            ${emailFooter}
        </div>`;
    return sendEmailViaAPI(userEmail, "Order Delivered! 🚚", html);
};

// 📧 4. WELCOME EMAIL
const sendWelcomeEmail = async (userEmail, username, role) => {
    const html = `
        <div style="max-width: 600px; margin: auto; font-family: Arial, sans-serif; border: 1px solid #e2e8f0; border-radius: 10px;">
            ${emailHeader}
            <div style="padding: 40px; text-align: center; background-color: #ffffff;">
                <h1 style="color: #1e293b; font-size: 24px;">Welcome to the Family! 🎉</h1>
                <p style="color: #475569; font-size: 16px;">Hello <b>${username}</b>, we are excited to have you as a <b>${role}</b>.</p>
                <div style="margin-top: 30px;">
                    <a href="${frontendUrl}" style="background-color: #2874f0; color: white; padding: 15px 40px; text-decoration: none; font-weight: bold; border-radius: 3px; display: inline-block;">START SHOPPING</a>
                </div>
            </div>
            ${emailFooter}
        </div>`;
    return sendEmailViaAPI(userEmail, "Welcome to Bhavyams Hub!", html);
};

module.exports = {
    sendOrderEmail,
    sendDeliveryEmail,
    sendOTPEmail,
    sendWelcomeEmail
};