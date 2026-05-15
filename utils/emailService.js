const axios = require('axios');
require('dotenv').config();

const BREVO_API_URL = 'https://api.brevo.com/v3/smtp/email';
const API_KEY = process.env.BREVO_API_KEY; 
const SENDER_EMAIL = process.env.EMAIL_USER; 
const frontendUrl = process.env.FRONTEND_URL || 'https://bhavyams-vendor-hub-vpk.vercel.app';

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
        <p style="color: #64748b; font-size: 12px; margin: 0;">System Engineered by A. Venkata Pavan Kumar</p>
        <p style="color: #94a3b8; font-size: 10px; margin-top: 5px;">&copy; 2026 Bhavyams VendorHub. All Rights Reserved.</p>
    </div>
`;

const sendEmailViaAPI = async (to, subject, htmlContent) => {
    try {
        await axios.post(BREVO_API_URL, {
            sender: { name: "Bhavyams Hub", email: SENDER_EMAIL },
            to: [{ email: to }],
            subject: subject,
            htmlContent: htmlContent
        }, {
            headers: { 'api-key': API_KEY, 'Content-Type': 'application/json' }
        });
    } catch (error) {
        console.error("❌ Brevo API Error:", error.response?.data || error.message);
    }
};

const sendOTPEmail = async (userEmail, otp, username = "Valued Customer") => {
    const html = `
        <div style="max-width: 500px; margin: auto; font-family: Arial, sans-serif; border: 1px solid #e2e8f0; border-radius: 10px;">
            ${emailHeader}
            <div style="padding: 30px; text-align: center; background-color: #ffffff;">
                <h2 style="color: #1e293b;">Account Verification</h2>
                <p style="color: #475569; font-size: 16px;">Hi <b>${username}</b>,</p>
                <p style="color: #475569;">Use the code below to securely sign in to your account.</p>
                <div style="background: #f1f3f6; padding: 20px; border-radius: 8px; margin: 25px 0; font-size: 32px; font-weight: bold; color: #2874f0; letter-spacing: 8px;">
                    ${otp}
                </div>
            </div>
            ${emailFooter}
        </div>`;
    return sendEmailViaAPI(userEmail, `Your Verification Code: ${otp}`, html);
};

const sendOrderEmail = async (userEmail, orderDetails, username = "Valued Customer") => {
    const { order_id, product_name, total_price, image_url } = orderDetails;
    const rawUrl = image_url || '';
    const cleanImg = rawUrl.replace(/["\\]/g, '').startsWith('http') ? rawUrl.replace(/["\\]/g, '') : `https://bhavyams-vendorhub-backend.onrender.com${rawUrl.replace(/["\\]/g, '')}`;

    const html = `
        <div style="max-width: 600px; margin: auto; font-family: Arial, sans-serif; border: 1px solid #e2e8f0; border-radius: 10px;">
            ${emailHeader}
            <div style="padding: 30px; background-color: #ffffff;">
                <h2 style="color: #16a34a; margin-top: 0; text-align: center;">Woohoo! Order Confirmed ✅</h2>
                <p style="color: #475569; font-size: 16px;">Hi <b>${username}</b>,</p>
                <p style="color: #475569;">Your order <b>#${order_id}</b> has been successfully placed.</p>
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

const sendDeliveryEmail = async (userEmail, orderDetails, username = "Valued Customer") => {
    const { order_id, product_name, image_url } = orderDetails;
    const rawUrl = image_url || '';
    const cleanImg = rawUrl.replace(/["\\]/g, '').startsWith('http') ? rawUrl.replace(/["\\]/g, '') : `https://bhavyams-vendorhub-backend.onrender.com${rawUrl.replace(/["\\]/g, '')}`;

    const html = `
        <div style="max-width: 600px; margin: auto; font-family: Arial, sans-serif; border: 1px solid #e2e8f0; border-radius: 10px;">
            ${emailHeader}
            <div style="padding: 30px; text-align: center; background-color: #ffffff;">
                <h2 style="color: #2874f0;">Your order is delivered! 🏠</h2>
                <p style="color: #475569; font-size: 16px; text-align: left;">Hi <b>${username}</b>,</p>
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

// 🚀 UPGRADED: SMART FALLBACKS (No Backend Changes Needed)
const sendRefundEmail = async (userEmail, orderDetails, username = "Valued Customer") => {
    
    // SMART PARSER: Automatically figures out the price and name from whatever the backend sent
    let productName = "Your Item";
    let amount = "0.00";
    let orderId = "N/A (Failed prior to generation)";

    if (typeof orderDetails === 'string') {
        productName = orderDetails;
    } else if (orderDetails) {
        productName = orderDetails.product_name || orderDetails.name || "Your Item";
        amount = orderDetails.total_price || orderDetails.price || orderDetails.amount || "0.00";
        orderId = orderDetails.id || orderDetails.order_id || "N/A (Failed prior to generation)";
    }

    const txnId = `TXN_DEMO_${Math.floor(100000 + Math.random() * 900000)}`; 

    const html = `
        <div style="max-width: 600px; margin: auto; font-family: Arial, sans-serif; border: 1px solid #e2e8f0; border-radius: 10px; overflow: hidden;">
            ${emailHeader}
            <div style="padding: 30px; background-color: #ffffff;">
                
                <h2 style="color: #333333; margin-top: 0; font-size: 20px; border-bottom: 2px solid #f0f0f0; padding-bottom: 15px;">
                    Order Cancellation & Refund
                </h2>
                
                <p style="color: #333333; font-size: 15px; margin-top: 20px;">Dear <b>${username}</b>,</p>
                
                <p style="color: #555555; font-size: 14px; line-height: 1.6;">
                    We are writing to inform you that we could not fulfill your order for <b>${productName}</b> due to a simultaneous checkout conflict.
                </p>

                <h3 style="color: #333333; font-size: 16px; margin-top: 25px;">What Happened?</h3>
                <p style="color: #555555; font-size: 14px; line-height: 1.6;">
                    Our system received two successful payments for the final available unit at the exact same fraction of a second. Unfortunately, the other transaction went through just ahead of yours, causing the item to instantly go out of stock before your order could be allocated. We sincerely apologize for this inconvenience.
                </p>

                <div style="background-color: #fffbeb; border-left: 4px solid #f59e0b; padding: 12px 15px; margin: 20px 0;">
                    <p style="margin: 0; color: #b45309; font-size: 13px;">
                        <strong>TEST MODE NOTICE:</strong> Since this is a test environment, no real money was deducted. This email serves to demonstrate the automated refund flow architecture.
                    </p>
                </div>

                <h3 style="color: #333333; font-size: 16px; margin-top: 25px;">Refund Details</h3>
                <div style="background-color: #f8fafc; border: 1px solid #e2e8f0; border-radius: 6px; padding: 20px; margin-top: 10px;">
                    <table style="width: 100%; font-size: 14px; color: #333333;">
                        <tr>
                            <td style="padding-bottom: 8px; color: #64748b;">Attempted Order ID:</td>
                            <td style="padding-bottom: 8px; font-weight: bold; text-align: right;">${orderId}</td>
                        </tr>
                        <tr>
                            <td style="padding-bottom: 8px; color: #64748b;">Transaction ID:</td>
                            <td style="padding-bottom: 8px; font-weight: bold; text-align: right;">${txnId}</td>
                        </tr>
                        <tr>
                            <td style="padding-bottom: 8px; color: #64748b;">Paid Amount:</td>
                            <td style="padding-bottom: 8px; font-weight: bold; color: #2874f0; text-align: right;">₹${amount}</td>
                        </tr>
                        <tr>
                            <td style="padding-bottom: 8px; color: #64748b;">Refund Method:</td>
                            <td style="padding-bottom: 8px; text-align: right;">Original Payment Method (Test Gateway)</td>
                        </tr>
                        <tr>
                            <td style="padding-top: 8px; color: #64748b; border-top: 1px dashed #cbd5e1;">Status:</td>
                            <td style="padding-top: 8px; font-weight: bold; color: #16a34a; text-align: right;">Refund Processed Successfully</td>
                        </tr>
                    </table>
                </div>

                <h3 style="color: #333333; font-size: 16px; margin-top: 30px;">When will you get your money back?</h3>
                <p style="color: #555555; font-size: 14px; line-height: 1.6;">
                    The refund was triggered automatically by our gateway. Depending on your bank's processing cycle, the funds will reflect in your account within:
                </p>
                <ul style="color: #555555; font-size: 14px; line-height: 1.6; padding-left: 20px;">
                    <li><b>UPI / Wallets:</b> 24 to 48 Hours</li>
                    <li><b>Net Banking / Cards:</b> 3 to 5 Business Days</li>
                </ul>

                <p style="color: #555555; font-size: 14px; line-height: 1.6; margin-top: 20px;">
                    You do not need to take any action. If you have any questions, please reply directly to this email.
                </p>

                <p style="color: #333333; font-size: 14px; margin-top: 30px;">
                    Warm regards,<br>
                    <strong>The Bhavyams Hub Team</strong>
                </p>

            </div>
            ${emailFooter}
        </div>`;
        
    return sendEmailViaAPI(userEmail, `Important: Order Cancellation & Immediate Refund Initiated for ${productName}`, html);
};

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

module.exports = { sendOrderEmail, sendDeliveryEmail, sendOTPEmail, sendWelcomeEmail, sendRefundEmail };