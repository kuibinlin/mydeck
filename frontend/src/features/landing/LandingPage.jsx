// LandingPage — public marketing page.
// Structure: sections are imported and composed here.
// To reorder or add sections, edit this file only.
import HeroSection from './sections/HeroSection'
import FeaturesSection from './sections/FeaturesSection'
import HowItWorksSection from './sections/HowItWorksSection'
import CTASection from './sections/CTASection'

export default function LandingPage() {
  return (
    <main>
      <HeroSection />
      <FeaturesSection />
      <HowItWorksSection />
      <CTASection />
    </main>
  )
}
