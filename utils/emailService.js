const nodemailer = require('nodemailer');

const transporter = nodemailer.createTransport({
    host: 'smtp.gmail.com',
    port: 465,
    secure: true, // Use SSL
    auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS
    },
    tls: {
        rejectUnauthorized: false // 🚀 Helps bypass some cloud firewall issues
    },
    connectionTimeout: 10000, // 10 seconds
    greetingTimeout: 10000,
    socketTimeout: 10000,
    family: 4 // 🚀 Forces IPv4 (Render often fails on IPv6)
});
// 🌐 Dynamically get the Frontend URL (Falls back to your current Vercel link)
const frontendUrl = process.env.FRONTEND_URL || 'https://bhavyams-vendor-hub-vpk.vercel.app';

// 🎨 REUSABLE LOGO HEADER
const emailHeader = `
    <div style="text-align: center; padding-bottom: 20px; border-bottom: 2px solid #f1f5f9; margin-bottom: 20px;">
        <h1 style="color: #0f172a; margin: 0; font-size: 28px; font-family: Arial, sans-serif; letter-spacing: -1px;">
            Bhavyams <span style="color: #2874f0;">Hub</span>
        </h1>
        <p style="color: #64748b; font-size: 11px; margin: 5px 0 0 0; text-transform: uppercase; letter-spacing: 2px; font-family: Arial, sans-serif;">
            Official Vendor & Retail Network
        </p>
    </div>
`;

const getEmailImg = (url) => {
    if (!url) return 'https://via.placeholder.com/150?text=No+Image';
    return url.startsWith('http') ? url : `https://via.placeholder.com/150?text=Bhavyams+Item`;
};

// 🛍️ 1. ORDER CONFIRMATION EMAIL
const sendOrderEmail = async (userEmail, orderDetails) => {
    const mailOptions = {
        from: `"Bhavyams VendorHub" <${process.env.EMAIL_USER}>`,
        to: userEmail,
        subject: `Order Confirmed! #${orderDetails.order_id} 🎉`,
        html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: auto; border: 1px solid #e2e8f0; padding: 30px; border-radius: 16px; background: #ffffff;">
            ${emailHeader}
            <h2 style="color: #3b82f6; text-align: center; margin-top: 0;">Order Confirmed!</h2>
            <p style="color: #334155; font-size: 15px;">Hi there,</p>
            <p style="color: #334155; font-size: 15px;">Your payment was successful. The vendor is preparing your order.</p>
            
            <table style="width: 100%; background: #f8fafc; padding: 15px; border-radius: 12px; margin-top: 20px; border-collapse: collapse;">
                <tr>
                    <td style="width: 90px; vertical-align: middle; padding-right: 15px;">
                        <img src="${getEmailImg(orderDetails.image_url)}" alt="Product" style="width: 80px; height: 80px; border-radius: 8px; object-fit: cover; border: 1px solid #cbd5e1; display: block;" />
                    </td>
                    <td style="vertical-align: middle;">
                        <h3 style="margin: 0 0 5px 0; color: #0f172a; font-size: 18px; line-height: 1.2;">${orderDetails.product_name}</h3>
                        <p style="margin: 0; color: #64748b; font-size: 13px;">Order ID: <b>#${orderDetails.order_id}</b></p>
                        <h2 style="margin: 8px 0 0 0; color: #16a34a; font-size: 20px;">₹${orderDetails.total_price}</h2>
                    </td>
                </tr>
            </table>
            <p style="font-size: 13px; text-align: center; color: #64748b; margin-top: 30px;">
                <a href="${frontendUrl}/dashboard" style="color: #2874f0; text-decoration: none;">Track order in your Dashboard</a>
            </p>
        </div>
        `
    };

    try { await transporter.sendMail(mailOptions); console.log("Order Email Sent!"); } 
    catch (error) { console.error("Email Error:", error); }
};

// 🚚 2. DELIVERY SUCCESS EMAIL
const sendDeliveryEmail = async (userEmail, orderDetails) => {
    const mailOptions = {
        from: `"Bhavyams VendorHub" <${process.env.EMAIL_USER}>`,
        to: userEmail,
        subject: `Delivered! Order #${orderDetails.order_id} 🚚✅`,
        html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: auto; border: 2px solid #10b981; padding: 30px; border-radius: 16px; background: #ffffff;">
            ${emailHeader}
            <h2 style="color: #10b981; text-align: center; margin-top: 0;">Successfully Delivered</h2>
            <div style="text-align: center; margin: 20px 0;">
                <img src="${getEmailImg(orderDetails.image_url)}" alt="Product" style="width: 120px; height: 120px; border-radius: 12px; object-fit: cover; border: 2px solid #e2e8f0; display: block; margin: 0 auto;" />
                <h3 style="margin: 15px 0 5px 0; color: #0f172a;">${orderDetails.product_name}</h3>
            </div>
            <div style="text-align: center; margin-top: 30px;">
                <a href="${frontendUrl}/dashboard" style="background: #10b981; color: white; padding: 12px 25px; text-decoration: none; border-radius: 8px; font-weight: bold; display: inline-block;">Leave a Review</a>
            </div>
        </div>
        `
    };

    try { await transporter.sendMail(mailOptions); console.log("Delivery Email Sent!"); } 
    catch (error) { console.error("Delivery Email Error:", error); }
};

// 🔐 3. OTP EMAIL
const sendOTPEmail = async (userEmail, otp) => {
    const mailOptions = {
        from: `"Bhavyams VendorHub Security" <${process.env.EMAIL_USER}>`,
        to: userEmail,
        subject: 'Your Verification Code 🔐',
        html: `
        <div style="font-family: Arial, sans-serif; max-width: 500px; margin: auto; border: 1px solid #e2e8f0; padding: 30px; border-radius: 16px; text-align: center;">
            ${emailHeader}
            <h2 style="color: #0f172a;">Verify Your Email</h2>
            <h1 style="background: #f8fafc; color: #2874f0; display: inline-block; padding: 15px 30px; letter-spacing: 8px; border-radius: 8px; border: 1px dashed #cbd5e1;">${otp}</h1>
            <p style="color: #94a3b8; font-size: 12px; margin-top: 20px;">Code expires in 5 minutes. Do not share it.</p>
        </div>
        `
    };
    await transporter.sendMail(mailOptions);
};

// 🚀 4. WELCOME EMAIL
const sendWelcomeEmail = async (userEmail, username, role) => {
    const mailOptions = {
        from: `"Bhavyams VendorHub" <${process.env.EMAIL_USER}>`,
        to: userEmail,
        subject: 'Welcome to the Family! 🚀',
        html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: auto; border: 2px solid #2874f0; padding: 30px; border-radius: 16px; text-align: center;">
            ${emailHeader}
            <h2 style="color: #2874f0;">Hello, ${username}!</h2>
            <p style="color: #334155; font-size: 16px;">Welcome to <b>Bhavyams Hub</b>. Your account as a <strong>${role.toUpperCase()}</strong> is ready.</p>
            <div style="margin-top: 30px;">
                <a href="${frontendUrl}" style="background: #2874f0; color: white; padding: 12px 30px; text-decoration: none; border-radius: 8px; font-weight: bold; display: inline-block;">Enter Marketplace</a>
            </div>
        </div>
        `
    };
    await transporter.sendMail(mailOptions);
};

module.exports = { sendOrderEmail, sendDeliveryEmail, sendOTPEmail, sendWelcomeEmail };