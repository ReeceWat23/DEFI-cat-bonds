import { BrowserRouter, Routes, Route } from 'react-router-dom'
import HomePage from './pages/HomePage'
import DealPage from './pages/DealPage'
import AdminPage from './pages/AdminPage'
import BuildBondPage from './pages/BuildBondPage'
import HomePageV2 from './pages/v2/HomePageV2'

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/deal" element={<DealPage />} />
        <Route path="/admin" element={<AdminPage />} />
        <Route path="/build" element={<BuildBondPage />} />
        <Route path="/v2" element={<HomePageV2 />} />
      </Routes>
    </BrowserRouter>
  )
}
