import { Code } from "@/components/typography/code";
import { Link } from "@/components/typography/link";

export default function Layouts() {
  return (
    <main className="container grid md:grid-cols-3 gap-12 p-4">
      <Link href="/layouts/sticky-header-sticky-footer">
        Sticky header, sticky footer
        <div className="pt-2">
          <div className="border-2 border-primary">
            <div className="h-4 w-full bg-layout-header"></div>
            <div className="h-32 w-full bg-layout-content"></div>
            <div className="h-4 w-full bg-layout-footer"></div>
          </div>
        </div>
      </Link>

      <Link href="/layouts/sticky-header-footer-below-fold">
        Sticky header, footer below fold
        <div className="pt-2">
          <div className="border-2 border-primary">
            <div className="h-4 w-full bg-layout-header"></div>
            <div className="h-32 w-full bg-layout-content"></div>
          </div>
          <div className="h-4 w-full bg-layout-footer"></div>
        </div>
      </Link>

      <Link href="/layouts/sticky-header-sidebar-footer-below-fold">
        Sticky header, sticky sidebar, footer below fold
        <div className="pt-2">
          <div className="border-2 border-primary">
            <div className="h-4 w-full bg-layout-header"></div>
            <div className="flex">
              <div className="h-32 w-20 bg-layout-sidebar"></div>
              <div className="h-32 w-full bg-layout-content"></div>
            </div>
          </div>
          <div className="h-4 w-full bg-layout-footer"></div>
        </div>
      </Link>

      <Link href="/layouts/sticky-header-sidebar-footer-inside">
        Sticky header, sticky sidebar, footer inside & below fold
        <div className="pt-2">
          <div className="border-2 border-primary">
            <div className="h-4 w-full bg-layout-header"></div>
            <div className="flex">
              <div className="h-32 w-20 bg-layout-sidebar"></div>
              <div className="h-32 w-full bg-layout-content"></div>
            </div>
          </div>
          <div className="flex">
            <div className="w-20.5"></div>
            <div className="h-4 w-full bg-layout-footer"></div>
          </div>
        </div>
      </Link>

      <Link href="/layouts/sticky-header-sidebar-sticky-footer">
        Sticky header, sticky sidebar, sticky footer
        <div className="pt-2">
          <div className="border-2 border-primary">
            <div className="h-4 w-full bg-layout-header"></div>
            <div className="flex">
              <div className="h-32 w-20 bg-layout-sidebar"></div>
              <div className="h-32 w-full bg-layout-content"></div>
            </div>
            <div className="h-4 w-full bg-layout-footer"></div>
          </div>
        </div>
      </Link>

      <Link href="/layouts/sticky-sides-flex-content">
        Sticky header & sidebar & footer, full-screen content
        <div className="pt-2">
          <div className="border-2 border-primary">
            <div className="h-4 w-full bg-layout-header"></div>
            <div className="flex">
              <div className="h-32 w-20 bg-layout-sidebar"></div>
              <div className="h-32 w-full bg-layout-content p-2">
                <div className="h-full w-full bg-layout-content-detail"></div>
              </div>
            </div>
            <div className="h-4 w-full bg-layout-footer"></div>
          </div>
        </div>
      </Link>

      <Link href="/layouts/sticky-sides-flex-content-simple">
        Sticky header & sidebar & footer, full-screen content (simple)
        <div className="pt-2">
          <div className="border-2 border-primary">
            <div className="h-4 w-full bg-layout-header"></div>
            <div className="flex">
              <div className="h-32 w-20 bg-layout-sidebar"></div>
              <div className="h-32 w-full bg-layout-content p-2">
                <div className="h-full w-full bg-layout-content-detail"></div>
              </div>
            </div>
            <div className="h-4 w-full bg-layout-footer"></div>
          </div>
        </div>
      </Link>

      <Link href="/layouts/sticky-header-sidebar-footer-below-fold-responsive">
        Sticky header & sidebar, footer below fold, responsive
        <div className="pt-2 grid grid-cols-layout-preview gap-2">
          <div>
            <div className="border-2 border-primary">
              <div className="h-4 w-full bg-layout-header flex items-center justify-end p-1">
                <div className="h-2 w-2 bg-layout-header-detail" />
              </div>
              <div className="flex">
                <div className="h-32 w-full bg-layout-content"></div>
              </div>
            </div>
          </div>
          <div>
            <div className="border-2 border-primary">
              <div className="h-4 w-full bg-layout-header flex items-center justify-end p-1">
                <div className="h-2 w-2 bg-layout-header-detail" />
              </div>
              <div className="flex">
                <div className="h-32 w-full bg-layout-sidebar"></div>
              </div>
            </div>
          </div>
          <div>
            <div className="border-2 border-primary">
              <div className="h-4 w-full bg-layout-header"></div>
              <div className="flex">
                <div className="h-32 w-20 bg-layout-sidebar"></div>
                <div className="h-32 w-full bg-layout-content"></div>
              </div>
            </div>
            <div className="h-4 w-full bg-layout-footer"></div>
          </div>
        </div>
      </Link>
      <p>
        Done with layouts? Simply delete the <Code>app/layouts</Code> directory.
      </p>
    </main>
  );
}
