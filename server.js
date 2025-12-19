const express = require('express')
const cookieParser = require('cookie-parser')
const cors = require('cors')

const app = express()
const PORT = process.env.PORT || 3000

const users = {}

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
  const userId = 'demo_user' // sau này thay bằng google id

  if (!users[userId]) {
    users[userId] = {
      totalBlocks: 2000
    }
  }

  res.cookie('userId', userId, {
    httpOnly: true,
    secure: true,
    sameSite: 'none',
    maxAge: 7 * 24 * 60 * 60 * 1000
  })

  res.json({ success: true })
})

app.get('/me', (req, res) => {
  const userId = req.cookies.userId
  if (!userId || !users[userId]) {
    return res.status(401).json({ error: 'Unauthorized' })
  }

  const totalBlocks = users[userId].totalBlocks

  res.json({
    totalBlocks,
    tokens: Math.ceil(totalBlocks / 1000)
  })
})

app.post('/logout', (req, res) => {
  res.clearCookie('token', {
    secure: true,
    sameSite: 'none'
  })
  res.json({ success: true })
})

app.post('/convert', (req, res) => {
  const userId = req.cookies.userId
  if (!userId || !users[userId]) {
    return res.status(401).json({ error: 'Chưa đăng nhập' })
  }

  const blocksUsed = req.body.blocks || 0
  const user = users[userId]

  if (user.totalBlocks < blocksUsed) {
    return res.status(403).json({ error: 'Hết block' })
  }

  user.totalBlocks -= blocksUsed

  res.json({
    success: true,
    totalBlocks: user.totalBlocks,
    tokens: Math.ceil(user.totalBlocks / 1000)
  })
})

// always cuoi file
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`)
})
