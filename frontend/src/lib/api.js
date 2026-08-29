const configured = import.meta.env.VITE_API_URL
const API_URL = (configured || '').replace(/\/+$/, '')

export default API_URL
