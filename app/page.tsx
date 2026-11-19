import { Hero } from "@/components/landing/hero"
import { TrustedBy } from "@/components/landing/trusted-by"
import { CraftExperiences } from "@/components/landing/craft-experiences"
import { Testimonials } from "@/components/landing/testimonials"

export default function HomePage() {
  return (
    <main className="bg-white">
      <Hero />
      <TrustedBy />
      <CraftExperiences />
      <Testimonials />
    </main>
  )
}
