import { NOOKLINK_API_ORIGIN } from './webviewDomains';

export interface ServiceIdentity {
	serviceId: number;
	serviceUri: string;
}

export function isZeldaNotes(session: ServiceIdentity): boolean {
	return (
		[5935781783175168, 4974384874151936].includes(session.serviceId) ||
		/87abc152|zelda|znotes/i.test(session.serviceUri)
	);
}

export function isNookLink(session: ServiceIdentity): boolean {
	return session.serviceId === 4953919198265344 || /acbaa|nooklink/i.test(session.serviceUri);
}

export function isSmashWorld(session: ServiceIdentity): boolean {
	return (
		[5598642853249024, 5614999764533248].includes(session.serviceId) ||
		/smash|aaaba/i.test(session.serviceUri)
	);
}

export function isSplatNet2(session: ServiceIdentity): boolean {
	return (
		session.serviceId === 5741031244955648 ||
		/splatoon2\.nintendo\.net|splatnet2/i.test(session.serviceUri)
	);
}

export function isStaticServiceAsset(target: URL): boolean {
	return (
		target.pathname.startsWith('/_next/static/') ||
		target.pathname.startsWith('/_next/image') ||
		/\.(?:js|mjs|css|png|jpe?g|gif|svg|webp|ico|woff2?|ttf|eot|mp4|webm)$/i.test(target.pathname)
	);
}

export function rewriteNookLinkApiOrigin(source: string): string {
	return source.split(NOOKLINK_API_ORIGIN).join('');
}

/** Exact hydration compatibility transforms from the working worker proxy. */
export function patchZeldaNotesJavascript(jsText: string): string {
	const targetCreateContext = 'let u=(0,r.createContext)(void 0),p=(0,r.createContext)(void 0);';
	if (jsText.includes(targetCreateContext)) {
		jsText = jsText.replace(
			targetCreateContext,
			'let _dUS={initialUserSettingsPromise:Promise.resolve({}),updatedUserSettings:{},updateUserSettings:()=>()=>Promise.resolve()};let u=(0,r.createContext)(_dUS),p=(0,r.createContext)(_dUS);'
		);
	}
	const targetFunctionH =
		'function h(e){let{initialUserSettingsPromise:t,updatedUserSettings:l,updateUserSettings:i}=function(){let{titleInfo:e}=(0,o.D)();switch(e.id){case a.vI.id:return(0,r.use)(u);case a.Tb.id:return(0,r.use)(p);default:throw Error(e)}}(),s=(0,r.use)(t);return{userSettings:(0,n.A)({},s,l)[e],updateUserSettings:i(e)}}';
	if (jsText.includes(targetFunctionH)) {
		jsText = jsText.replace(
			targetFunctionH,
			'function h(e){let ctx=function(){try{let{titleInfo:e}=(0,o.D)();switch(e.id){case a.vI.id:return(0,r.use)(u)||(0,r.use)(p);case a.Tb.id:return(0,r.use)(p)||(0,r.use)(u);default:return(0,r.use)(u)||(0,r.use)(p)}}catch(_){}}()||{initialUserSettingsPromise:Promise.resolve({}),updatedUserSettings:{},updateUserSettings:()=>()=>Promise.resolve()};let{initialUserSettingsPromise:t,updatedUserSettings:l,updateUserSettings:i}=ctx,s;try{s=t?(0,r.use)(t):{}}catch(_){s={}}return{userSettings:(0,n.A)({},s,l)[e]||{},updateUserSettings:typeof i==="function"?i(e):(()=>Promise.resolve())}}'
		);
	}
	if (/=\(0,([a-zA-Z0-9_$]+)\.useState\)\(([a-zA-Z0-9_$]+)\.Tb\)/g.test(jsText)) {
		jsText = jsText.replace(
			/=\(0,([a-zA-Z0-9_$]+)\.useState\)\(([a-zA-Z0-9_$]+)\.Tb\)/g,
			'=(0,$1.useState)(()=>((typeof location!=="undefined"&&location.pathname.toLowerCase().includes("botw"))?$2.vI:$2.Tb))'
		);
	}
	if (
		/switch\(([a-zA-Z0-9_$]+)\.id\)\{case ([a-zA-Z0-9_$]+)\.vI\.id:return\(0,([a-zA-Z0-9_$]+)\.use\)\(([a-zA-Z0-9_$]+)\);case \2\.Tb\.id:return\(0,\3\.use\)\(([a-zA-Z0-9_$]+)\);default:throw Error\(\1\)\}/g.test(
			jsText
		)
	) {
		jsText = jsText.replace(
			/switch\(([a-zA-Z0-9_$]+)\.id\)\{case ([a-zA-Z0-9_$]+)\.vI\.id:return\(0,([a-zA-Z0-9_$]+)\.use\)\(([a-zA-Z0-9_$]+)\);case \2\.Tb\.id:return\(0,\3\.use\)\(([a-zA-Z0-9_$]+)\);default:throw Error\(\1\)\}/g,
			'switch($1.id){case $2.vI.id:return(0,$3.use)($4)||(0,$3.use)($5)||{initialUserSettingsPromise:Promise.resolve({}),updatedUserSettings:{},updateUserSettings:()=>()=>Promise.resolve()};case $2.Tb.id:return(0,$3.use)($5)||(0,$3.use)($4)||{initialUserSettingsPromise:Promise.resolve({}),updatedUserSettings:{},updateUserSettings:()=>()=>Promise.resolve()};default:throw Error($1)}'
		);
	}

	return jsText;
}
