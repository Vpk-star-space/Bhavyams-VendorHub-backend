const sgMail = require('@sendgrid/mail');

// 🔑 Set API Key
sgMail.setApiKey(process.env.SENDGRID_API_KEY);

// 🌐 Frontend URL
const frontendUrl = process.env.FRONTEND_URL || 'https://bhavyams-vendor-hub-vpk.vercel.app';

// 🎨 HEADER
const emailHeader = `
    <div style="text-align:center;padding-bottom:20px;border-bottom:2px solid #f1f5f9;margin-bottom:20px;">
        <h1 style="color:#0f172a;margin:0;font-size:28px;">Bhavyams <span style="color:#2874f0;">Hub</span></h1>
        <p style="color:#64748b;font-size:11px;margin-top:5px;">Official Vendor & Retail Network</p>
    </div>
`;

// 🛍️ ORDER EMAIL
const sendOrderEmail = async (userEmail, orderDetails) => {
    const msg = {
        to: userEmail,
        from: process.env.EMAIL_USER,
        subject: `Order Confirmed! #${orderDetails.order_id}`,
        html: `
            <div style="max-width:600px;margin:auto;padding:20px;">
                ${emailHeader}
                <h2>Order Confirmed!</h2>
                <p>${orderDetails.product_name}</p>
                <p>₹${orderDetails.total_price}</p>
                <a href="${frontendUrl}/dashboard">Track Order</a>
            </div>
        `
    };

    await sgMail.send(msg);
};

// 🚚 DELIVERY EMAIL
const sendDeliveryEmail = async (userEmail, orderDetails) => {
    const msg = {
        to: userEmail,
        from: process.env.EMAIL_USER,
        subject: `Delivered! #${orderDetails.order_id}`,
        html: `
            <div style="max-width:600px;margin:auto;padding:20px;">
                ${emailHeader}
                <h2>Delivered Successfully</h2>
                <p>${orderDetails.product_name}</p>
            </div>
        `
    };

    await sgMail.send(msg);
};

// 🔐 OTP EMAIL
const sendOTPEmail = async (userEmail, otp) => {
    const msg = {
        to: userEmail,
        from: process.env.EMAIL_USER,
        subject: "Your OTP Code",
        html: `
            <div style="text-align:center;">
                ${emailHeader}
                <h2>Your OTP</h2>
                <h1 style="letter-spacing:5px;">${otp}</h1>
                <p>Valid for 5 minutes</p>
            </div>
        `
    };

    await sgMail.send(msg);
};

// 🎉 WELCOME EMAIL
const sendWelcomeEmail = async (userEmail, username, role) => {
    const msg = {
        to: userEmail,
        from: process.env.EMAIL_USER,
        subject: "Welcome!",
        html: `
            <div style="text-align:center;">
                ${emailHeader}
                <h2>Welcome ${username}</h2>
                <p>Your role: ${role}</p>
                <a href="${frontendUrl}">Start Now</a>
            </div>
        `
    };

    await sgMail.send(msg);
};

module.exports = {
    sendOrderEmail,
    sendDeliveryEmail,
    sendOTPEmail,
    sendWelcomeEmail
};