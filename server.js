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

// test login
app.post('/login', (req, res) => {
  const userId = 'demo_user' 

  if (!users[userId]) {
    // moi acc co san 2 tokens
    users[userId] = {
      tokens: 2 
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

  const user = users[userId]

  res.json({
    tokens: user.tokens,
    totalBlocks: user.tokens * 1000 // quy doi de hien thi
  })
})

app.post('/convert', async (req, res) => {
  try {
    const userId = req.cookies.userId
    if (!userId || !users[userId]) {
      return res.status(401).json({ error: 'Chưa đăng nhập' })
    }

    if (convertingUsers.has(userId)) {
      return res.status(429).json({
        error: 'Bạn đang có 1 convert đang chạy'
      })
    }

    const blocksToConvert = Number(req.body?.blocks || 0)
    const cost = Math.ceil(blocksToConvert / 1000)
    const user = users[userId]

    if (user.tokens < cost) {
      return res.status(403).json({
        error: `Bạn không đủ Token`
      })
    }

    convertingUsers.add(userId)

    try {
      await new Promise(r => setTimeout(r, 3000))
      user.tokens -= cost

      res.json({
        success: true,
        tokens: user.tokens
      })
    } finally {
      convertingUsers.delete(userId)
    }
  } catch (err) {
    console.error('CONVERT ERROR:', err)
    res.status(500).json({ error: 'Server error' })
  }
})

app.post('/logout', (req, res) => {
  res.clearCookie('userId', {
    secure: true,
    sameSite: 'none'
  })
  res.json({ success: true })
})

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`)
})