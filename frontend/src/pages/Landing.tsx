import '../components/landing/landing.css'
import { CallToAction } from '../components/landing/CallToAction'
import { Features } from '../components/landing/Features'
import { Footer } from '../components/landing/Footer'
import { Header } from '../components/landing/Header'
import { Hero } from '../components/landing/Hero'
import { HowItWorks } from '../components/landing/HowItWorks'
import { Showcase } from '../components/landing/Showcase'

export function Landing() {
  return (
    <div className="landingRoot">
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <Header />
      <main id="main">
        <Hero />
        <Features />
        <HowItWorks />
        <Showcase />
        <CallToAction />
      </main>
      <Footer />
    </div>
  )
}
