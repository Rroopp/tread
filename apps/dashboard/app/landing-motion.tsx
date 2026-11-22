'use client';

import { useEffect } from 'react';

export function LandingMotion() {
  useEffect(() => {
    const root = document.querySelector<HTMLElement>('.tread-landing');
    if (!root) return;

    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduceMotion || !('IntersectionObserver' in window)) return;

    const targets = root.querySelectorAll<HTMLElement>(
      '.editorial-section, .evidence-section, .closing-section',
    );
    targets.forEach((target) => target.classList.add('reveal-on-scroll'));
    root.classList.add('landing-motion-ready');

    const observer = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        entry.target.classList.add('in-view');
        observer.unobserve(entry.target);
      });
    }, { threshold: 0.12, rootMargin: '0px 0px -6% 0px' });

    targets.forEach((target) => observer.observe(target));
    return () => {
      observer.disconnect();
      root.classList.remove('landing-motion-ready');
      targets.forEach((target) => target.classList.remove('reveal-on-scroll', 'in-view'));
    };
  }, []);

  return null;
}
