# Complete Setup Guide for WhatsApp Waste Collection Bot + Admin Dashboard

## 🚀 Quick Setup Checklist

### 1. Twilio WhatsApp Setup
- [ ] Create Twilio account at https://www.twilio.com
- [ ] Enable WhatsApp Sandbox or get approved WhatsApp Business Account
- [ ] Get Account SID and Auth Token from Twilio Console
- [ ] Configure webhook URL: `https://your-domain.com/webhook` (or ngrok for local testing)

### 2. Firebase Setup
- [ ] Create Firebase project at https://console.firebase.google.com
- [ ] Enable Firestore Database
- [ ] Create service account and download private key
- [ ] Set up Firebase Authentication (optional)
- [ ] Configure Firestore security rules

### 3. AWS S3 Setup
- [ ] Create AWS account and S3 bucket
- [ ] Configure bucket for public read access
- [ ] Set up CORS policy for web access
- [ ] Create IAM user with S3 permissions
- [ ] Get Access Key ID and Secret Access Key

### 4. Environment Variables Setup
Create `.env.local` file with these variables:

\`\`\`env
# Twilio Configuration
TWILIO_ACCOUNT_SID=your_twilio_account_sid
TWILIO_AUTH_TOKEN=your_twilio_auth_token

# Firebase Configuration (Frontend)
NEXT_PUBLIC_FIREBASE_API_KEY=your_firebase_api_key
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=your_project.firebaseapp.com
NEXT_PUBLIC_FIREBASE_PROJECT_ID=your_project_id
NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET=your_project.appspot.com
NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=your_sender_id
NEXT_PUBLIC_FIREBASE_APP_ID=your_app_id

# Firebase Admin (Backend)
FIREBASE_PROJECT_ID=your_project_id
FIREBASE_CLIENT_EMAIL=your_service_account_email
FIREBASE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\nyour_private_key\n-----END PRIVATE KEY-----\n"

# AWS S3 Configuration
AWS_ACCESS_KEY_ID=your_aws_access_key
AWS_SECRET_ACCESS_KEY=your_aws_secret_key
AWS_BUCKET_NAME=your_bucket_name
AWS_REGION=us-east-1

# Application Configuration
WHATSAPP_PORT=3001
FRONTEND_URL=http://localhost:3000
\`\`\`

## 📱 Twilio WhatsApp Detailed Setup

### Step 1: WhatsApp Sandbox (For Testing)
1. Go to Twilio Console → Messaging → Try it out → Send a WhatsApp message
2. Follow instructions to join sandbox
3. Note your sandbox number (usually +1 415 523 8886)

### Step 2: Webhook Configuration
1. In Twilio Console → Messaging → Settings → WhatsApp sandbox settings
2. Set webhook URL to: `https://your-domain.com/webhook` (use ngrok for local testing)
3. HTTP method: POST

### Step 3: Production WhatsApp (After Testing)
1. Apply for WhatsApp Business Account approval
2. Complete business verification process
3. Update webhook URL to production domain

## 🔥 Firebase Detailed Setup

### Step 1: Create Project
\`\`\`bash
# Install Firebase CLI
npm install -g firebase-tools

# Login to Firebase
firebase login

# Initialize project (optional, for deployment)
firebase init
\`\`\`

### Step 2: Firestore Database
1. Go to Firebase Console → Firestore Database
2. Create database in production mode
3. Set up security rules:

\`\`\`javascript
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    // Allow read/write access to all documents
    match /{document=**} {
      allow read, write: if true;
    }
  }
}
\`\`\`

### Step 3: Service Account
1. Go to Project Settings → Service Accounts
2. Generate new private key
3. Download JSON file and extract credentials

## ☁️ AWS S3 Detailed Setup

### Step 1: Create S3 Bucket
\`\`\`bash
# Using AWS CLI (optional)
aws s3 mb s3://your-waste-collection-receipts
\`\`\`

### Step 2: Bucket Policy (Public Read Access)
\`\`\`json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "PublicReadGetObject",
      "Effect": "Allow",
      "Principal": "*",
      "Action": "s3:GetObject",
      "Resource": "arn:aws:s3:::your-bucket-name/*"
    }
  ]
}
\`\`\`

### Step 3: CORS Configuration
\`\`\`json
[
  {
    "AllowedHeaders": ["*"],
    "AllowedMethods": ["GET", "PUT", "POST", "DELETE"],
    "AllowedOrigins": ["*"],
    "ExposeHeaders": []
  }
]
\`\`\`

## 🖥️ Local Development

### Step 1: Install Dependencies
\`\`\`bash
npm install
\`\`\`

### Step 2: Start Both Services
\`\`\`bash
# Start both frontend and backend
npm run dev:both

# Or start separately
npm run dev          # Frontend (port 3000)
npm run dev:server   # Backend (port 3001)
\`\`\`

### Step 3: Test with ngrok (for WhatsApp webhook)
\`\`\`bash
# Install ngrok
npm install -g ngrok

# Expose local server
ngrok http 3001

# Use the ngrok URL in Twilio webhook settings
# Example: https://abc123.ngrok.io/webhook
\`\`\`

## 🧪 Testing the Integration

### Step 1: Test WhatsApp Bot
1. Send "Hi" to your Twilio WhatsApp number
2. Follow the conversation flow
3. Upload a payment receipt image
4. Check if data appears in Firebase Firestore

### Step 2: Test Dashboard
1. Open http://localhost:3000
2. Check if data from WhatsApp appears in real-time
3. Test filtering and search functionality
4. Verify images load from S3

### Step 3: Test Webhook
\`\`\`bash
# Use the test script
node server/test-webhook.js
\`\`\`

## 🚀 Production Deployment

### Frontend (Vercel)
\`\`\`bash
# Deploy to Vercel
npm install -g vercel
vercel

# Add environment variables in Vercel dashboard
\`\`\`

### Backend Options

#### Option 1: Railway
\`\`\`bash
# Install Railway CLI
npm install -g @railway/cli

# Deploy
railway login
railway init
railway up
\`\`\`

#### Option 2: Render
1. Connect GitHub repository
2. Set environment variables
3. Deploy as web service

#### Option 3: AWS EC2/ECS
- Use Docker container
- Set up load balancer
- Configure auto-scaling

## 🔧 Troubleshooting

### Common Issues

1. **WhatsApp messages not received**
   - Check webhook URL is accessible
   - Verify Twilio credentials
   - Check server logs for errors

2. **Images not displaying**
   - Verify S3 bucket permissions
   - Check CORS configuration
   - Ensure URLs are publicly accessible

3. **Firebase connection errors**
   - Verify service account credentials
   - Check Firestore security rules
   - Ensure project ID is correct

4. **Local development issues**
   - Use ngrok for webhook testing
   - Check all environment variables
   - Verify ports are not in use

### Debug Commands
\`\`\`bash
# Check if services are running
curl http://localhost:3000/api/health
curl http://localhost:3001/health

# Test Firebase connection
node -e "console.log(process.env.FIREBASE_PROJECT_ID)"

# Test AWS S3 connection
aws s3 ls s3://your-bucket-name
\`\`\`

## 📋 Final Checklist

Before going live:
- [ ] All environment variables configured
- [ ] Twilio webhook pointing to production URL
- [ ] Firebase security rules updated for production
- [ ] S3 bucket properly configured
- [ ] SSL certificate installed (HTTPS required for WhatsApp)
- [ ] Error monitoring set up (Sentry, LogRocket, etc.)
- [ ] Backup strategy for Firebase data
- [ ] Rate limiting configured for API endpoints

## 🎯 Success Metrics

Your setup is working correctly when:
1. ✅ WhatsApp messages trigger webhook calls
2. ✅ User data is stored in Firebase Firestore
3. ✅ Images are uploaded to S3 and accessible
4. ✅ Dashboard shows real-time data updates
5. ✅ All filtering and search functions work
6. ✅ Mobile responsive design works on all devices

## 📞 Support

If you encounter issues:
1. Check the troubleshooting section above
2. Review server logs for error messages
3. Test each service individually
4. Verify all credentials and configurations
