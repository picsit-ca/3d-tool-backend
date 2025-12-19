const express = require('express')
const cookieParser = require('cookie-parser')
const cors = require('cors')

const app = express()
const PORT = process.env.PORT || 3000

app.use(express.json())
app.use(cookieParser())

app.use(cors({
  origin: true,
  credentials: true
}))

app.get('/', (req, res) => {
  res.send('Backend OK')
})

// giả lập login
app.post('/login', (req, res) => {
  // giả token
  const token = 'secure_token_example'

  res.cookie('token', token, {
    httpOnly: true,
    secure: true,
    sameSite: 'none',
    maxAge: 24 * 60 * 60 * 1000
  })

  res.json({ success: true })
})

app.get('/me', (req, res) => {
  const token = req.cookies.token
  if (!token) return res.status(401).json({ error: 'Unauthorized' })

  res.json({ user: 'ok', token })
})

app.post('/logout', (req, res) => {
  res.clearCookie('token')
  res.json({ success: true })
})

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`)
})

app.post('/convert', (req, res) => {
  const token = req.cookies.token
  if (!token) {
    return res.status(401).json({ error: 'Chưa đăng nhập' })
  }

  res.json({
    success: true,
    message: 'Convert OK (server)'
  })
})
