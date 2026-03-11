// Intersection Observer for scroll animations
document.addEventListener('DOMContentLoaded', () => {
    // Animate elements on scroll
    const observerOptions = {
        threshold: 0.1,
        rootMargin: '0px 0px -50px 0px'
    };

    const observer = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                entry.target.style.opacity = '1';
                entry.target.style.transform = 'translateY(0)';
                observer.unobserve(entry.target);
            }
        });
    }, observerOptions);

    // Observe sections
    document.querySelectorAll('.feature-card, .step, .screenshot-card, .tech-pill').forEach(el => {
        el.style.opacity = '0';
        el.style.transform = 'translateY(20px)';
        el.style.transition = 'opacity 0.6s ease-out, transform 0.6s ease-out';
        observer.observe(el);
    });

    // Smooth progress bar animation
    const barObserver = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                entry.target.querySelectorAll('.pbar-fill').forEach(bar => {
                    const width = bar.style.width;
                    bar.style.width = '0';
                    requestAnimationFrame(() => {
                        requestAnimationFrame(() => {
                            bar.style.width = width;
                        });
                    });
                });
                barObserver.unobserve(entry.target);
            }
        });
    }, { threshold: 0.3 });

    document.querySelectorAll('.mock-progress-bars').forEach(el => {
        barObserver.observe(el);
    });

    // Calorie ring animation restart on scroll
    const ringObserver = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                const ring = entry.target.querySelector('.ring-animate');
                if (ring) {
                    ring.style.animation = 'none';
                    requestAnimationFrame(() => {
                        ring.style.animation = 'ringFill 2s ease-out forwards';
                    });
                }
            }
        });
    }, { threshold: 0.5 });

    document.querySelectorAll('.mock-ring').forEach(el => {
        ringObserver.observe(el);
    });

    // Smooth scroll for nav links
    document.querySelectorAll('.nav-links a').forEach(link => {
        link.addEventListener('click', (e) => {
            e.preventDefault();
            const target = document.querySelector(link.getAttribute('href'));
            if (target) {
                target.scrollIntoView({ behavior: 'smooth', block: 'start' });
            }
        });
    });
});
