import { library, dom } from '/node_modules/@fortawesome/fontawesome-svg-core/index.mjs';
import { faCopy } from '/node_modules/@fortawesome/free-regular-svg-icons/index.mjs';
import { faLink, faLinkSlash } from '/node_modules/@fortawesome/free-solid-svg-icons/index.mjs';

library.add(faCopy, faLink, faLinkSlash);
dom.watch();
