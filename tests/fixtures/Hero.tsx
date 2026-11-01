export function Hero() {
  const title = "Unlock the power of your photos";
  const id = "hero_section_main";
  console.log("🚀 Starting sync");
  return (
    <section aria-label="Seamlessly organize your library">
      <h1>Say goodbye to clutter</h1>
      <p>Capysort uses AI to automatically sort your photos — effortlessly.</p>
      <Button label="Get started" />
      <img alt="A smart, intuitive dashboard" src="/hero.png" />
    </section>
  );
}
