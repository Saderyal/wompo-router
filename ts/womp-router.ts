import {
	type LazyCallbackResult,
	type LazyResult,
	RenderHtml,
	WompComponent,
	WompProps,
	createContext,
	defineWomp,
	lazy,
	useCallback,
	useContext,
	useEffect,
	useMemo,
	useState,
	Suspense,
	html,
	useRef,
} from 'womp';

/* 
================================================================
HELPERS
================================================================
*/
const buildTreeStructure = (
	childNodes: Node[] | NodeList,
	structure: RouteStructure[] = [],
	parent: RouteStructure = null,
	toPreload: LazyResult[] = []
): [RouteStructure[], LazyResult[]] => {
	childNodes.forEach((child) => {
		if (child instanceof (Route as WompComponent).class) {
			const props = child.props as RouteProps;
			const lazyComp = props.lazy ? lazy(props.lazy) : null;
			const route: RouteStructure = {
				...props,
				parent: parent,
				element: props.element,
				path: props.path,
				lazy: lazyComp,
				fallback: props.fallback,
				index: null,
				children: [],
			};
			if (lazyComp) toPreload.push(lazyComp);
			if (props.index) parent.index = route;
			structure.push(route);
			buildTreeStructure(child.childNodes, route.children, route, toPreload);
		}
	});
	return [structure, toPreload];
};

const getRoutes = (
	treeStructure: RouteStructure[],
	paths: [string, RouteStructure][] = [],
	parent: string = ''
) => {
	for (const route of treeStructure) {
		let newRoute = '';
		if (route.path) {
			const slash =
				(parent && !parent.endsWith('/')) || (!parent && !route.path.startsWith('/')) ? '/' : '';
			newRoute += parent + slash + route.path;
			paths.push([newRoute, route]);
		}
		if (route.children) {
			getRoutes(route.children, paths, newRoute);
		}
	}
	return paths;
};

interface Params {
	segments?: string[];
	[key: string]: any;
}

const getWichParametricRouteisMoreSpecific = (routes: Params) => {
	const parametricPaths = Object.keys(routes);
	parametricPaths.sort((a, b) => {
		const matchA = routes[a];
		const matchB = routes[b];
		const dynamicsA = Object.keys(matchA).filter((key) => key !== 'segments').length;
		const dynamicsB = Object.keys(matchB).filter((key) => key !== 'segments').length;
		const difference = dynamicsB - dynamicsA;
		if (difference === 0) {
			let staticsA = a.split('/');
			let staticsB = b.split('/');
			const lengthDifference = staticsB.length - staticsA.length;
			if (lengthDifference !== 0) return lengthDifference;
			let staticsALength = 0;
			let staticsBLength = 0;
			for (let i = 0; i < staticsA.length; i++) {
				const sA = staticsA[i];
				const sB = staticsB[i];
				if (!sA.startsWith(':')) staticsALength++;
				if (!sB.startsWith(':')) staticsBLength++;
				if (sA.startsWith(':') || sB.startsWith(':') || sA.startsWith('*') || sB.startsWith('*'))
					break;
			}
			return staticsBLength - staticsALength;
		}
		return difference;
	});
	return routes[parametricPaths[0]];
};

const getMatch = (
	routes: [string, RouteStructure][],
	broswerRoute: string
): [RouteStructure, Params] => {
	const matches: {
		exact?: RouteStructure;
		parametric?: Params;
		fallbacks?: Params;
	} = {
		exact: null,
		parametric: {},
		fallbacks: {},
	};
	const currentRoute =
		broswerRoute !== '/' && broswerRoute.endsWith('/')
			? broswerRoute.substring(0, broswerRoute.length - 1)
			: broswerRoute;
	for (const routeStructure of routes) {
		const [routePath, route] = routeStructure;
		const isFallback = routePath.endsWith('*');
		if (!isFallback && routePath.split('/').length !== currentRoute.split('/').length) continue;
		if (routePath === currentRoute) {
			matches.exact = route;
			break;
		}
		if (!routePath.includes(':') && !routePath.includes('*')) continue;
		const segments = routePath.split('/');
		let regex = '';
		// Skips first element
		const paramNames: string[] = [];
		for (let i = 1; i < segments.length; i++) {
			const segment = segments[i];
			regex += '\\/';
			if (segment.startsWith(':')) {
				if (i === segments.length - 1) regex += '(.*)';
				else regex += '(.*?)';
				paramNames.push(segment.substring(1));
			} else if (segment === '*') {
				regex += '(.*)';
				paramNames.push('segments');
			} else {
				regex += segment;
			}
		}
		const matchRegex = new RegExp(regex, 'g');
		const match = matchRegex.exec(currentRoute);
		if (match) {
			const params: { [key: string]: string } = {};
			// Skips first element, which is the whole match
			for (let i = 1; i < match.length; i++) {
				params[paramNames[i - 1]] = match[i];
			}
			if (isFallback) matches.fallbacks[routePath] = [route, params];
			else matches.parametric[routePath] = [route, params];
		}
	}
	const parametricPaths = Object.keys(matches.parametric);
	const fallbackPaths = Object.keys(matches.fallbacks);
	let match: [RouteStructure, Params] = [null, null];
	if (matches.exact) {
		match = [matches.exact, {}];
	} else if (parametricPaths.length) {
		match = getWichParametricRouteisMoreSpecific(matches.parametric);
	} else if (fallbackPaths.length) {
		match = getWichParametricRouteisMoreSpecific(matches.fallbacks);
	}
	const redirect = match[0].redirect || match[0].index?.redirect;
	if (redirect) {
		const newPath = getFullPath(broswerRoute, redirect);
		history.replaceState({}, undefined, newPath);
		match = getMatch(routes, newPath);
	}
	return match;
};

const getFullPath = (prevRoute: string, newRoute: string) => {
	return newRoute.startsWith('/')
		? newRoute
		: prevRoute + (prevRoute.endsWith('/') ? '' : '/') + newRoute;
};

const getRouteContent = (route: RouteStructure) => {
	if (!route) return null;
	return html`
		<${SingleRouteContext.Provider} value=${{ ...route }}>
			${
				route.lazy
					? route.fallback
						? html`
							<${Suspense} fallback=${route.fallback}>
								<${route.lazy} />
							</${Suspense}>
						`
						: html`<${route.lazy} />`
					: route.element
			}
		</${SingleRouteContext.Provider}>
	`;
};

/* 
================================================================
ROUTES
================================================================
*/
interface RoutesProps extends WompProps {}

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

interface RouterContext {
	route: RouteStructure;
	params: any;
	currentRoute: string;
	setNewRoute: (newValue: string, push?: boolean) => void;
}
const RouterContext = createContext<RouterContext>({
	route: null,
	params: null,
	currentRoute: null,
	setNewRoute: null,
});

export function Routes({ children }: RoutesProps) {
	const [currentRoute, setCurrentRoute] = useState(window.location.pathname);
	const context = useRef<RouterContext>({
		route: null,
		params: null,
		currentRoute: null,
		setNewRoute: null,
	});

	const setNewRoute = useCallback((newRoute: string, pushState: boolean = true) => {
		setCurrentRoute((prevRoute) => {
			const nextRoute = getFullPath(prevRoute, newRoute);
			if (pushState && prevRoute !== nextRoute) {
				history.pushState({}, null, nextRoute);
				context.current.currentRoute = nextRoute;
			}
			return nextRoute;
		});
	});

	context.current.currentRoute = currentRoute;
	context.current.setNewRoute = setNewRoute;

	const treeStructure = useMemo(() => {
		const [tree, toPreload] = buildTreeStructure(children.nodes);
		// Preload lazy components
		if (window.requestIdleCallback) {
			// TODO doesnt work on Safari
			toPreload.forEach((asyncComponent) => {
				requestIdleCallback(asyncComponent);
			});
		}
		return tree;
	}, []);
	const routes: [string, RouteStructure][] = useMemo(() => getRoutes(treeStructure), []);

	useEffect(() => {
		window.addEventListener('popstate', () => {
			setNewRoute(window.location.pathname, false);
		});
	}, []);

	const [route, params] = getMatch(routes, currentRoute);
	context.current.params = params;

	if (!route) return html`<div>Not found!</div>`; //! Make custom component. Allow to override it.
	let root = route;
	let nextRoute = null;
	root.nextRoute = nextRoute;
	while (root.parent) {
		nextRoute = root;
		root = root.parent;
		root.nextRoute = nextRoute;
	}
	context.current.route = root;
	return html`<${RouterContext.Provider} value=${context.current}>${getRouteContent(root)}</${
		RouterContext.Provider
	}>`;
}

defineWomp(Routes, {
	name: 'womp-routes',
});

/* 
================================================================
ROUTE
================================================================
*/

const SingleRouteContext = createContext<RouteStructure>(null);

interface RouteProps extends WompProps {
	path?: string;
	index?: boolean;
	redirect?: string;
	element?: RenderHtml;
	lazy?: () => LazyCallbackResult;
	fallback?: RenderHtml;
	route?: RouteStructure;
}

export function Route({ route }: RouteProps) {
	return html``;
}

defineWomp(Route, {
	name: 'womp-route',
});

/* 
================================================================
CHILD-ROUTE
================================================================
*/
export function ChildRoute() {
	const route = useContext(SingleRouteContext);
	let toRender: RouteStructure = null;
	if (route) {
		const newRoute = route.nextRoute;
		if (newRoute) {
			toRender = newRoute;
		} else if (route.index) {
			toRender = route.index;
		}
	}
	return getRouteContent(toRender);
}

defineWomp(ChildRoute, {
	name: 'womp-child-route',
});

/* 
================================================================
LINK
================================================================
*/
interface LinkProps extends WompProps {
	to: string;
}

export function Link({ to, children }: LinkProps) {
	const navigate = useNavigate();
	const route = useContext(SingleRouteContext);
	let href = to;
	if (!href.startsWith('/')) {
		let parentRoute = route;
		while (parentRoute) {
			const parentPath = parentRoute.path;
			if (parentPath) {
				const slash = !parentPath.endsWith('/') ? '/' : '';
				href = parentRoute.path + slash + href;
			}
			parentRoute = parentRoute.parent;
		}
	}
	const onLinkClick = (ev: Event) => {
		ev.preventDefault();
		navigate(href);
	};
	return html`<a href=${href} @click=${onLinkClick}>${children}</a> `;
}
Link.css = `:host { display: inline-block; }`;
defineWomp(Link, {
	name: 'womp-link',
});

/* 
================================================================
NAV-LINK
================================================================
*/
export function NavLink({ to, children }: LinkProps) {
	const navigate = useNavigate();
	const currentRoute = useCurrentRoute();
	const route = useContext(SingleRouteContext);
	let href = to;
	if (!href.startsWith('/')) {
		let parentRoute = route;
		while (parentRoute) {
			const parentPath = parentRoute.path;
			if (parentPath) {
				const slash = !parentPath.endsWith('/') ? '/' : '';
				href = parentRoute.path + slash + href;
			}
			parentRoute = parentRoute.parent;
		}
	}
	const onLinkClick = (ev: Event) => {
		ev.preventDefault();
		navigate(href);
	};
	const isActive = currentRoute === href;
	return html`<a class=${isActive && 'active'} href=${href} @click=${onLinkClick}>${children}</a>`;
}
NavLink.css = `:host { display: inline-block; }`;

defineWomp(NavLink, {
	name: 'womp-nav-link',
});

/* 
================================================================
HOOKS
================================================================
*/
export const useParams = () => {
	const routerContext = useContext(RouterContext);
	return routerContext.params;
};

export const useNavigate = () => {
	const routerContext = useContext(RouterContext);
	return routerContext.setNewRoute;
};

export const useCurrentRoute = () => {
	const routerContext = useContext(RouterContext);
	return routerContext.currentRoute;
};