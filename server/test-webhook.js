const axios = require("axios")

const testMessages = [
  { Body: "hi", From: "whatsapp:+1234567890" },
  { Body: "John Doe", From: "whatsapp:+1234567890" },
  { Body: "123 Main St, Lagos", From: "whatsapp:+1234567890" },
  { Body: "1", From: "whatsapp:+1234567890" },
  { Body: "2024-12-25", From: "whatsapp:+1234567890" },
]

async function testWebhook() {
  const baseUrl = "http://localhost:3001"

  console.log("🧪 Testing WhatsApp webhook locally...\n")

  for (let i = 0; i < testMessages.length; i++) {
    const message = testMessages[i]
    console.log(`📤 Sending: "${message.Body}"`)

    try {
      const response = await axios.post(`${baseUrl}/whatsapp`, message, {
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
      })

      console.log(`📥 Response: ${response.status}`)
      console.log(`💬 Bot reply: ${response.data}\n`)

      // Wait 1 second between messages
      await new Promise((resolve) => setTimeout(resolve, 1000))
    } catch (error) {
      console.error(`❌ Error: ${error.message}\n`)
    }
  }
}

testWebhook()
