'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import Image from 'next/image'
import { usePathname, useRouter } from 'next/navigation'
import { motion, AnimatePresence } from 'framer-motion'
import { Home, Info, Wrench, FolderKanban, AlignJustify, X, Facebook, Instagram, Linkedin, Twitter } from 'lucide-react'
import { RippleButton } from '../components/shared/button'

export default function Header() {
  const [isOpen, setIsOpen] = useState(false)
  const [scrolled, setScrolled] = useState(false)
  const pathname = usePathname()
  const router = useRouter();

  const navItems = [
    { name: 'Home', href: '/', icon: Home },
    { name: 'About', href: '/about', icon: Info },
    { name: 'Services', href: '/services', icon: Wrench },
    { name: 'Projects', href: '/projects', icon: FolderKanban },
  ]

  const isActive = (href: string) => pathname === href

//   useEffect(() => {
//     const handleScroll = () => setScrolled(window.scrollY > 50)
//     window.addEventListener('scroll', handleScroll)
//     return () => window.removeEventListener('scroll', handleScroll)
//   }, [])

  return (
    <header
      className={`fixed top-0 w-full z-100 transition-all  duration-300
        ${scrolled ? 'bg-white shadow-md' : 'bg-transparent'}
      `}
    >
      <div className="max-w-7xl mx-auto flex items-center justify-between px-4 lg:px-6 py-4">

        {/* Logo */}
        <Link href="/" className="flex items-center">
          <Image
            src="/images/waste-connectlogo.png"
            alt="waste connect Logo"
            width={100}
            height={28}
            className="transition-all duration-300 max-sm:w-36 object-cover"
          />
        </Link>

        {/* Desktop Navigation */}
        <nav className="hidden md:flex b items-center space-x-6 lg:space-x-10">
          {navItems.map((item) => (
            <Link key={item.name} href={item.href}>
              <span
                className={`
                  relative text-sm font-semibold tracking-wide group transition-all duration-300
                  ${isActive(item.href)
                    ? 'text-black'
                    : scrolled
                      ? 'text-black'
                      : 'text-black hover:text-black'
                  }
                `}
              >
                {item.name}

                {/* underline */}
                <span
                  className={`
                    absolute left-0 -bottom-1 h-0.5 transition-all duration-300
                    ${isActive(item.href)
                      ? 'w-full bg-brand-red'
                      : 'w-0 bg-brand-red group-hover:w-full'}
                  `}
                />
              </span>
            </Link>
          ))}

          {/* Desktop CTA */}
          <RippleButton onClick={()=> router.push("/get-started")}>
            Get started
          </RippleButton>
        </nav>

        {/* Mobile Menu Button */}
        <button
          className="md:hidden"
          onClick={() => setIsOpen(true)}
        >
          <AlignJustify
            size={28}
            className={scrolled ? 'text-black' : 'text-white'}
          />
        </button>
      </div>

      {/* Mobile Overlay */}
      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-white p-6 flex flex-col z-100"
          >
            {/* Mobile header */}
            <div className="flex items-center justify-between">
              <Image
                src="/images/logonobg.png"
                alt="Latev Engineering Logo"
                width={140}
                height={40}
              />
              <button onClick={() => setIsOpen(false)} className="text-black">
                <X size={30} />
              </button>
            </div>

            {/* Mobile links */}
            <div className="mt-14 flex flex-col space-y-6">
              {navItems.map((item, i) => {
                const Icon = item.icon
                return (
                  <motion.div
                    key={item.name}
                    initial={{ x: -40, opacity: 0 }}
                    animate={{ x: 0, opacity: 1 }}
                    transition={{ delay: i * 0.1 }}
                  >
                    <Link
                      href={item.href}
                      onClick={() => setIsOpen(false)}
                      className={`
                        flex items-center justify-between py-4 border-b text-lg font-semibold
                        transition-all duration-300
                        ${isActive(item.href) ? 'text-brand-red' : 'text-black'}
                      `}
                    >
                      <div className="flex items-center gap-4">
                        <Icon
                          size={22}
                          className={isActive(item.href) ? 'text-brand-red' : 'text-red-500'}
                        />
                        {item.name}
                      </div>

                      {/* Active Dot */}
                      {isActive(item.href) && (
                        <span className="w-2 h-2 rounded-full bg-brand-green" />
                      )}
                    </Link>
                  </motion.div>
                )
              })}

              {/* Mobile CTA */}
            <RippleButton onClick={() => { setIsOpen(false); router.push("/contact"); }}>
                Contact Our Team
              </RippleButton>
            </div>

            {/* Social Icons */}
            <div className="mt-auto pt-10 flex items-center justify-end gap-6">
              <Link href="#" className="text-black hover:text-brand-red transition">
                <Facebook size={26} />
              </Link>
              <Link href="#" className="text-black hover:text-brand-red transition">
                <Instagram size={26} />
              </Link>
              <Link href="#" className="text-black hover:text-brand-red transition">
                <Linkedin size={26} />
              </Link>
              <Link href="#" className="text-black hover:text-brand-red transition">
                <Twitter size={26} />
              </Link>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </header>
  )
}
