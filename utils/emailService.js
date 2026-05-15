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

const sendRefundEmail = async (userEmail, orderData, username = "Valued Customer") => {
    // Console log layout structure for visibility during integration steps
    console.log("=== sendRefundEmail Payload Trace ===");
    console.log(JSON.stringify(orderData, null, 2));

    let productName = "Your Items";
    let extractedAmount = null;
    let orderId = `ORD_DEMO_${Math.floor(10000 + Math.random() * 90000)}`;

    if (typeof orderData === 'string') {
        productName = orderData;
    } 
    else if (Array.isArray(orderData) && orderData.length > 0) {
        productName = orderData[0].name || orderData[0].product_name || "Cart Items";
        extractedAmount = orderData.reduce((total, item) => total + (Number(item.price || item.total_price || 0) * (item.quantity || 1)), 0);
    } 
    else if (typeof orderData === 'object' && orderData !== null) {
        // Step 1: Handle nested collections vs direct names
        if (orderData.cartItems && orderData.cartItems.length > 0) {
            productName = orderData.cartItems.map(i => i.name || i.product_name).join(', ');
        } else if (orderData.order && (orderData.order.product_name || orderData.order.name)) {
            productName = orderData.order.product_name || orderData.order.name;
        } else {
            productName = orderData.product_name || orderData.name || "Your Items";
        }
        
        // Step 2: Advanced deep-layered checking strategy for structural numbers
        extractedAmount = 
            orderData.total_price || 
            orderData.finalTotal || 
            orderData.price || 
            orderData.amount ||
            (orderData.order ? (orderData.order.total_price || orderData.order.amount || orderData.order.price) : null) ||
            (orderData.payment ? (orderData.payment.amount || orderData.payment.total) : null);
        
        // Step 3: Parse out valid identity IDs safely
        if (orderData.order_id || orderData.id || orderData.razorpay_order_id) {
            orderId = orderData.order_id || orderData.id || orderData.razorpay_order_id;
        } else if (orderData.order && orderData.order.order_id) {
            orderId = orderData.order.order_id;
        }
    }

    // Process amount validation formatting
    let amountStr = "0.00";
    if (extractedAmount !== undefined && extractedAmount !== null) {
        let numAmount = Number(extractedAmount);
        // Protects against gateway values sent in paise (like Razorpay Indian fractional values)
        if (numAmount > 50000 && (!orderData.total_price)) { 
            numAmount = numAmount / 100;
        }
        if (!isNaN(numAmount) && numAmount !== 0) {
            amountStr = numAmount.toFixed(2);
        }
    }

    const txnId = `TXN_DEMO_${Math.floor(100000 + Math.random() * 900000)}`; 

    const html = `
        <div style="max-width: 600px; margin: auto; font-family: Arial, sans-serif; border: 1px solid #e2e8f0; border-radius: 10px; background-color: #ffffff;">
            ${emailHeader}
            <div style="padding: 30px;">
                <div style="background-color: #fef2f2; border-left: 4px solid #ef4444; padding: 15px; margin-bottom: 20px; border-radius: 4px;">
                    <h3 style="color: #991b1b; margin: 0; font-size: 16px;">Order Cancellation & Refund Notice</h3>
                    <p style="color: #7f1d1d; margin: 5px 0 0 0; font-size: 14px;">[TEST MODE]: Simultaneous Checkout Encountered</p>
                </div>
                
                <p style="color: #475569; font-size: 16px;">Dear <b>${username}</b>,</p>
                <p style="color: #475569; font-size: 14px; line-height: 1.5;">We regret to inform you that your transaction could not be processed completely. Another customer completed payment for the final available stock of <b>${productName}</b> at the exact same moment.</p>
                <p style="color: #475569; font-size: 14px; line-height: 1.5;">Because the inventory became exhausted during checkout concurrency, our system automatically cancelled your request and rolled back the transaction safely.</p>
                
                <h4 style="color: #1e293b; margin-top: 25px; border-bottom: 2px solid #f1f5f9; padding-bottom: 8px;">TRANSACTION SUMMARY</h4>
                <table style="width: 100%; font-size: 14px; color: #334155; margin-bottom: 20px;">
                    <tr>
                        <td style="padding: 6px 0; font-weight: bold; color: #64748b;">Order ID:</td>
                        <td style="padding: 6px 0; text-align: right; font-family: monospace; font-size: 15px;">#${orderId}</td>
                    </tr>
                    <tr>
                        <td style="padding: 6px 0; font-weight: bold; color: #64748b;">Transaction ID:</td>
                        <td style="padding: 6px 0; text-align: right; font-family: monospace; font-size: 15px;">${txnId}</td>
                    </tr>
                    <tr>
                        <td style="padding: 6px 0; font-weight: bold; color: #64748b;">Refunded Amount:</td>
                        <td style="padding: 6px 0; text-align: right; font-weight: bold; color: #2874f0; font-size: 16px;">₹${amountStr}</td>
                    </tr>
                    <tr>
                        <td style="padding: 6px 0; font-weight: bold; color: #64748b;">Refund Status:</td>
                        <td style="padding: 6px 0; text-align: right; font-weight: bold; color: #16a34a;">Initiated / Auto-Reversed</td>
                    </tr>
                </table>

                <div style="background-color: #f8fafc; border: 1px solid #e2e8f0; padding: 15px; border-radius: 6px; font-size: 13px; color: #475569; line-height: 1.4;">
                    <strong>Refund Timeline Notice:</strong> The money has been safely released from our gateway node. It will reflect automatically inside your original payment source (UPI account or Bank Card account) within <strong>3-5 business working days</strong> depending on your banking branch.
                </div>
            </div>
            ${emailFooter}
        </div>`;

    return sendEmailViaAPI(userEmail, `Order Cancellation & Auto-Refund: #${orderId}`, html);
};

module.exports = {
    sendOTPEmail,
    sendOrderEmail,
    sendDeliveryEmail,
    sendRefundEmail
};
