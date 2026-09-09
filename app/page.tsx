import { SiteHeader } from "@/components/landing/site-header"
import { Hero } from "@/components/landing/hero"
import { SkillsGrid } from "@/components/landing/skills-grid"
import { Pipeline } from "@/components/landing/pipeline"
import { BandCalculator } from "@/components/landing/band-calculator"
import { Verification } from "@/components/landing/verification"
import { Faq } from "@/components/landing/faq"
import { CtaSection } from "@/components/landing/cta-section"
import { SiteFooter } from "@/components/landing/site-footer"

export default function HomePage() {
  return (
    <div className="flex min-h-screen flex-col bg-background text-foreground">
      <SiteHeader />
      <main className="flex-1">
        <Hero />
        <SkillsGrid />
        <Pipeline />
        <BandCalculator />
        <Verification />
        <Faq />
        <CtaSection />
      </main>
      <SiteFooter />
    </div>
  )
}
