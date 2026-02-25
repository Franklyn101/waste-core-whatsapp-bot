#!/bin/bash

echo "🔍 Verifying WhatsApp Bot + Dashboard Setup..."

# Check if required environment variables are set
echo "📋 Checking environment variables..."

required_vars=(
    "TWILIO_ACCOUNT_SID"
    "TWILIO_AUTH_TOKEN"
    "NEXT_PUBLIC_FIREBASE_PROJECT_ID"
    "FIREBASE_PROJECT_ID"
    "FIREBASE_CLIENT_EMAIL"
    "FIREBASE_PRIVATE_KEY"
    "AWS_ACCESS_KEY_ID"
    "AWS_SECRET_ACCESS_KEY"
    "AWS_BUCKET_NAME"
)

missing_vars=()

for var in "${required_vars[@]}"; do
    if [ -z "${!var}" ]; then
        missing_vars+=("$var")
    else
        echo "✅ $var is set"
    fi
done

if [ ${#missing_vars[@]} -ne 0 ]; then
    echo "❌ Missing environment variables:"
    printf '%s\n' "${missing_vars[@]}"
    echo "Please set these variables in your .env.local file"
    exit 1
fi

echo "✅ All required environment variables are set!"

# Check if services are running
echo "🚀 Checking if services are running..."

# Check frontend
if curl -s http://localhost:3000 > /dev/null; then
    echo "✅ Frontend is running on port 3000"
else
    echo "❌ Frontend is not running on port 3000"
fi

# Check backend
if curl -s http://localhost:3001/health > /dev/null; then
    echo "✅ Backend is running on port 3001"
else
    echo "❌ Backend is not running on port 3001"
fi

# Test Firebase connection
echo "🔥 Testing Firebase connection..."
node -e "
const admin = require('firebase-admin');
try {
    if (!admin.apps.length) {
        admin.initializeApp({
            credential: admin.credential.cert({
                projectId: process.env.FIREBASE_PROJECT_ID,
                clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
                privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\\\n/g, '\\n')
            })
        });
    }
    console.log('✅ Firebase connection successful');
} catch (error) {
    console.log('❌ Firebase connection failed:', error.message);
}
"

# Test AWS S3 connection
echo "☁️ Testing AWS S3 connection..."
node -e "
const AWS = require('aws-sdk');
const s3 = new AWS.S3({
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
    region: process.env.AWS_REGION || 'us-east-1'
});

s3.headBucket({ Bucket: process.env.AWS_BUCKET_NAME }, (err, data) => {
    if (err) {
        console.log('❌ S3 connection failed:', err.message);
    } else {
        console.log('✅ S3 connection successful');
    }
});
"

echo "🎉 Setup verification complete!"
echo "📱 To test WhatsApp integration:"
echo "   1. Start ngrok: ngrok http 3001"
echo "   2. Update Twilio webhook URL with ngrok URL"
echo "   3. Send 'Hi' to your Twilio WhatsApp number"
echo "   4. Check dashboard for real-time updates"
