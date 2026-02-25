const axios = require("axios")

async function testIntegration() {
  console.log("🧪 Testing WhatsApp Bot Integration...\n")

  // Test webhook endpoint
  try {
    const webhookResponse = await axios.post("http://localhost:3001/webhook", {
      From: "whatsapp:+1234567890",
      Body: "Hi",
      MediaUrl0: "",
      NumMedia: "0",
    })

    console.log("✅ Webhook endpoint responding")
  } catch (error) {
    console.log("❌ Webhook endpoint failed:", error.message)
  }

  // Test health endpoints
  try {
    await axios.get("http://localhost:3001/health")
    console.log("✅ Backend health check passed")
  } catch (error) {
    console.log("❌ Backend health check failed:", error.message)
  }

  try {
    await axios.get("http://localhost:3000")
    console.log("✅ Frontend health check passed")
  } catch (error) {
    console.log("❌ Frontend health check failed:", error.message)
  }

  // Test complete conversation flow
  console.log("\n🔄 Testing complete conversation flow...")

  const conversationSteps = [
    { body: "Hi", expected: "name" },
    { body: "John Doe", expected: "address" },
    { body: "123 Main St", expected: "waste_type" },
    { body: "Organic", expected: "pickup_date" },
    { body: "2024-01-15", expected: "payment_receipt" },
  ]

  for (const step of conversationSteps) {
    try {
      const response = await axios.post("http://localhost:3001/webhook", {
        From: "whatsapp:+1234567890",
        Body: step.body,
        MediaUrl0: "",
        NumMedia: "0",
      })

      console.log(`✅ Step "${step.body}" processed successfully`)
    } catch (error) {
      console.log(`❌ Step "${step.body}" failed:`, error.message)
    }
  }

  console.log("\n🎉 Integration test complete!")
  console.log("📊 Check your dashboard at http://localhost:3000 for real-time updates")
}

testIntegration().catch(console.error)
