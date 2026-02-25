#!/bin/bash

echo "Setting up local development environment..."

# Create backend directory structure
mkdir -p whatsapp-bot-server
cd whatsapp-bot-server

# Initialize package.json
npm init -y

# Install backend dependencies
echo "Installing backend dependencies..."
npm install express twilio firebase-admin aws-sdk cors helmet morgan dotenv
npm install -D nodemon

# Create basic server structure
cat > server.js << 'EOF'
// Copy your WhatsApp bot server code here
// Make sure to use process.env.PORT || 3001 for the port
EOF

# Update package.json scripts
npm pkg set scripts.start="node server.js"
npm pkg set scripts.dev="nodemon server.js"

# Create environment template
cat > .env.example << 'EOF'
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
EOF

echo "Backend setup complete!"
echo "1. Copy your server code to whatsapp-bot-server/server.js"
echo "2. Copy .env.example to .env and fill in your credentials"
echo "3. Run 'npm run dev' to start the backend server"

cd ..
echo "Frontend is already set up. Add your Firebase config to .env.local"
