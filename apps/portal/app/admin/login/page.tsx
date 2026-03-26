'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000'

export default function AdminLoginPage() {
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError('')
    try {
      const res = await fetch(`${API_URL}/admin/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password })
      })
      const data = await res.json() as { token?: string; error?: string }
      if (!res.ok) throw new Error(data.error || 'Login failed')
      localStorage.setItem('adminToken', data.token!)
      localStorage.setItem('adminEmail', data.email as string || email)
      router.push('/admin/configure')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Login failed')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={{ fontFamily: 'Arial, sans-serif', minHeight: '100vh', background: '#f9fafb', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ width: '100%', maxWidth: 400, padding: 24 }}>
        <div style={{ background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)', padding: 32, borderRadius: '12px 12px 0 0', textAlign: 'center' }}>
          <h1 style={{ color: 'white', margin: 0, fontSize: 22 }}>Nodus AI Systems</h1>
          <p style={{ color: 'rgba(255,255,255,0.8)', margin: '8px 0 0', fontSize: 14 }}>Admin Portal</p>
        </div>

        <div style={{ background: 'white', padding: 32, borderRadius: '0 0 12px 12px', boxShadow: '0 4px 16px rgba(0,0,0,0.1)' }}>
          <form onSubmit={handleLogin}>
            <div style={{ marginBottom: 20 }}>
              <label style={{ display: 'block', fontSize: 13, fontWeight: 600, color: '#555', marginBottom: 6 }}>Email</label>
              <input
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                placeholder="lloyd@nodusaisystems.com"
                required
                style={{ width: '100%', padding: '12px 14px', border: '1px solid #ddd', borderRadius: 8, fontSize: 14, boxSizing: 'border-box' }}
              />
            </div>

            <div style={{ marginBottom: 24 }}>
              <label style={{ display: 'block', fontSize: 13, fontWeight: 600, color: '#555', marginBottom: 6 }}>Password</label>
              <input
                type="password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                placeholder="••••••••"
                required
                style={{ width: '100%', padding: '12px 14px', border: '1px solid #ddd', borderRadius: 8, fontSize: 14, boxSizing: 'border-box' }}
              />
            </div>

            {error && (
              <div style={{ background: '#fff5f5', border: '1px solid #fed7d7', borderRadius: 8, padding: '10px 14px', marginBottom: 16, fontSize: 14, color: '#e53e3e' }}>
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              style={{ width: '100%', padding: '13px', background: loading ? '#a0aec0' : 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)', color: 'white', border: 'none', borderRadius: 8, fontSize: 15, fontWeight: 600, cursor: loading ? 'not-allowed' : 'pointer' }}
            >
              {loading ? 'Signing in...' : 'Sign In'}
            </button>
          </form>
        </div>
      </div>
    </div>
  )
}
