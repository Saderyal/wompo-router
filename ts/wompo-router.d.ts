import { type LazyCallbackResult, type LazyResult, RenderHtml, WompoProps } from 'wompo';
interface RoutesProps extends WompoProps {
}
interface RouteStructure extends Omit<RouteProps, 'index' | 'children' | 'lazy'> {
    parent: RouteStructure;
    element: RenderHtml;
    path: string;
    children: RouteStructure[];
    index: RouteStructure;
    nextRoute?: RouteStructure;
    fallback: RenderHtml;
    lazy: LazyResult;
}
export declare function Routes({ children }: RoutesProps): RenderHtml;
interface RouteProps extends WompoProps {
    path?: string;
    index?: boolean;
    redirect?: string;
    element?: RenderHtml;
    lazy?: () => LazyCallbackResult;
    fallback?: RenderHtml;
    route?: RouteStructure;
    meta?: {
        title?: string;
        description?: string;
    };
}
export declare function Route(_: RouteProps): RenderHtml;
export declare function ChildRoute(): RenderHtml;
interface LinkProps extends WompoProps {
    to: string;
}
export declare function Link({ to, children }: LinkProps): RenderHtml;
export declare namespace Link {
    var css: string;
}
export declare function NavLink({ to, children }: LinkProps): RenderHtml;
export declare namespace NavLink {
    var css: string;
}
export declare const useParams: () => any;
export declare const useNavigate: () => (newValue: string, push?: boolean) => void;
export declare const useCurrentRoute: () => string;
export declare const useRoutes: () => [string, RouteStructure][];
export {};
