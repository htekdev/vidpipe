import 'dotenv/config'
const k = process.env.LATE_API_KEY
const r = await fetch('https://getlate.dev/api/v1/posts?status=scheduled', {headers:{'Authorization': 'Bearer ' + k}})
const d = await r.json()
const post = (d.data || d)[0]
console.log(JSON.stringify(post, null, 2))
