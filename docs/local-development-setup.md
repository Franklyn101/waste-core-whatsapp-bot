# Local Development Setup Guide

## Prerequisites
- Node.js 18+ installed
- Firebase project created
- AWS S3 bucket configured
- Twilio account with WhatsApp sandbox

## Backend Setup (WhatsApp Bot Server)

### 1. Create Backend Directory
\`\`\`bash
mkdir whatsapp-bot-server
cd whatsapp-bot-server
npm init -y
\`\`\`

### 2. Install Dependencies
\`\`\`bash
npm install express twilio firebase-admin aws-sdk cors helmet morgan dotenv
npm install -D nodemon
\`\`\`

### 3. Environment Variables (.env)
\`\`\`env
PORT=3001
TWILIO_ACCOUNT_SID=your_twilio_account_sid
TWILIO_AUTH_TOKEN=your_twilio_auth_token
TWILIO_PHONE_NUMBER=whatsapp:+14155238886
FIREBASE_PROJECT_ID=your_firebase_project_id
FIREBASE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n"
FIREBASE_CLIENT_EMAIL=your_service_account_email
AWS_ACCESS_KEY_ID=your_aws_access_key
AWS_SECRET_ACCESS_KEY=your_aws_secret_key
AWS_REGION=us-east-1
AWS_S3_BUCKET=your_s3_bucket_name
\`\`\`

### 4. Package.json Scripts
\`\`\`json
{
  "scripts": {
    "start": "node server.js",
    "dev": "nodemon server.js"
  }
}
\`\`\`

### 5. Run Backend
\`\`\`bash
npm run dev
# Server runs on http://localhost:3001
\`\`\`

## Frontend Setup (Next.js Dashboard)

### 1. Environment Variables (.env.local)
\`\`\`env
NEXT_PUBLIC_FIREBASE_API_KEY=your_firebase_api_key
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=your_project.firebaseapp.com
NEXT_PUBLIC_FIREBASE_PROJECT_ID=your_firebase_project_id
NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET=your_project.appspot.com
NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=your_sender_id
NEXT_PUBLIC_FIREBASE_APP_ID=your_app_id
\`\`\`

### 2. Run Frontend
\`\`\`bash
npm run dev
# Dashboard runs on http://localhost:3000
\`\`\`

## Testing the Integration

### 1. Start Both Servers
\`\`\`bash
# Terminal 1 - Backend
cd whatsapp-bot-server
npm run dev

# Terminal 2 - Frontend  
cd waste-dashboard
npm run dev
\`\`\`

### 2. Test WhatsApp Bot
- Send message to your Twilio WhatsApp sandbox number
- Check backend logs for incoming webhooks
- Verify data appears in Firebase Firestore
- Check dashboard for real-time updates

### 3. Webhook URL for Local Testing
Use ngrok to expose your local backend:
\`\`\`bash
npx ngrok http 3001
# Use the ngrok URL in Twilio webhook configuration
\`\`\`

## Troubleshooting

### Common Issues
1. **CORS Errors**: Backend includes CORS middleware for localhost:3000
2. **Firebase Connection**: Ensure service account key is properly formatted
3. **S3 Images**: Check bucket permissions and CORS policy
4. **Real-time Updates**: Verify Firebase rules allow read access

### Debug Mode
Add to backend server.js:
\`\`\`javascript
console.log('[DEBUG] Webhook received:', req.body);
console.log('[DEBUG] Firebase write result:', result);
