import { FakeParagraphs } from "@/components/helpers/FakeParagraphs";
import { FakeWordList } from "@/components/helpers/FakeWordList";
import { Footer } from "@/components/layout/footer";
import { Paragraph } from "@/components/layout/paragraph";
import { StickyHeader } from "@/components/layout/sticky-header";
import { StickySidebar } from "@/components/layout/sticky-sidebar";

export default function Layout() {
  return (
    <>
      <StickyHeader className="p-2">Sticky header</StickyHeader>
      {/* Remove `container` if you want full-page width layout */}
      <div className="container grid grid-cols-layout-sidebar">
        <StickySidebar className="top-layout-header h-layout-content">
          <div>Sticky sidebar</div>
          <FakeWordList count={3} length={[4, 15]} />
        </StickySidebar>
        <main>
          <div className="min-h-layout-inner-content">
            <Paragraph>Main content</Paragraph>
            <FakeParagraphs words={80} count={5} />
          </div>
          <Footer>Footer below fold inside the main column</Footer>
        </main>
      </div>
    </>
  );
}
