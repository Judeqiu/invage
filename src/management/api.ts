import { signupSubmissions, SubmissionError, type SubmissionRepository } from '../signup/submissions.js';
import { Router, type Request, type RequestHandler } from 'express';
import { configuredInvitationCode } from './invitation-code.js';
import { requireAuth, requireAdmin, sessionUser, issueInviteCode, listInviteCodes, isBillingEnabled } from 'utarus';
import { inviteOnboardUrl, originFromRequest } from '../../node_modules/utarus/dist/onboarding/invite-url.js';
import { MANAGER_ROLE, ManagementError, managementRepository, type ManagementRepository } from './repository.js';

type RepositorySource = () => ManagementRepository;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const actor = (req: Request) => JSON.stringify({userId:sessionUser(req).userId ?? null,name:sessionUser(req).displayName});

export function createManagementRouter(getRepository: RepositorySource = managementRepository, getSignup: () => SubmissionRepository = signupSubmissions) {
  const router = Router();
  router.use(requireAuth);
  router.use((_req,res,next) => {res.setHeader('Cache-Control','private, no-store');next();});
  router.param('userId',(req,res,next,id) => {
    if (!uuid.test(id)) {res.status(400).json({error:'Invalid user ID.'});return;}next();
  });
  const fullAdmin: RequestHandler = async (req,res,next) => {
    requireAdmin(req,res,() => {void (async () => {
      try {
        const user = sessionUser(req);
        if (user.userId) {
          const identity = await getRepository().identity(user.userId);
          if (!identity || identity.deleted || !identity.admin) {res.status(403).json({error:'Full administrator access required.'});return;}
        }
        next();
      } catch (error) {next(error);}
    })();});
  };
  router.use((req,res,next) => {
    if (['GET','HEAD','OPTIONS'].includes(req.method)) {next();return;}
    const origin=req.get('origin'), host=req.get('host');
    if (!host || !origin || ![`https://${host}`,`http://${host}`].includes(origin) ||
      (req.get('sec-fetch-site') && req.get('sec-fetch-site') !== 'same-origin')) {
      res.status(403).json({error:'A same-origin request is required.'});return;
    }
    if (!req.is('application/json')) {res.status(415).json({error:'Expected application/json.'});return;}
    next();
  });
  router.get('/roles/:userId',fullAdmin,async(req,res) => {
    const identity=await getRepository().identity(String(req.params.userId));
    if (!identity) throw new ManagementError('User not found.',404);
    res.json({role:MANAGER_ROLE,enabled:identity.manager,eligible:!identity.admin&&!identity.deleted});
  });
  router.patch('/roles/:userId',fullAdmin,async(req,res) => {
    if (!req.body || Object.keys(req.body).join(',')!=='enabled' || typeof req.body.enabled!=='boolean') throw new ManagementError('Send enabled: true or false.');
    const identity=await getRepository().setRole(String(req.params.userId),req.body.enabled,actor(req));
    res.json({role:MANAGER_ROLE,enabled:identity!.manager,eligible:!identity!.admin&&!identity!.deleted});
  });
  router.use(async(req,res,next) => {
    try {
      const id=sessionUser(req).userId;
      if (!id || !await getRepository().isManager(id)) {res.status(403).json({error:'Velovest manager access required.'});return;}
      next();
    } catch (error) {next(error);}
  });
  router.get('/signup-dates', async (_req,res) => {
    res.json({disabledDates:await getSignup().disabledDates()});
  });
  router.patch('/signup-dates/:date', async (req,res) => {
    if (!req.body || Object.keys(req.body).join(',') !== 'enabled' || typeof req.body.enabled !== 'boolean')
      throw new ManagementError('Send enabled: true or false.');
    await getSignup().setDateEnabled(String(req.params.date),req.body.enabled,actor(req));
    res.json({date:req.params.date,enabled:req.body.enabled});
  });
  router.get('/users',async(req,res) => {
    if (req.query.q!==undefined && typeof req.query.q!=='string') throw new ManagementError('Invalid search.');
    res.json({users:await getRepository().subscribers(typeof req.query.q==='string'?req.query.q.trim():''),billingEnabled:isBillingEnabled()});
  });
  router.get('/users/:userId',async(req,res) => {
    const rows=await getRepository().subscribers('',String(req.params.userId));
    if (!rows[0]) throw new ManagementError('User not found.',404);
    res.json({user:rows[0],billingEnabled:isBillingEnabled()});
  });
  router.get('/invites',async(_req,res) => {
    const codes=(await listInviteCodes('all')).filter(code=>!code.org_id&&!code.role)
      .map(code=>({code:code.code,createdAt:code.created_at,comment:code.comment??'',recipientEmail:code.recipient_email??'',usedAt:code.used_at??null}));
    res.json({codes});
  });
  router.post('/invites',async(req,res) => {
    if (!req.body || typeof req.body!=='object' || Array.isArray(req.body) || Object.keys(req.body).some(key=>!['comment','recipientEmail'].includes(key)) ||
      (req.body.comment!==undefined && typeof req.body.comment!=='string')) throw new ManagementError('Only an optional invite comment and recipientEmail are accepted.');
    if (req.body.recipientEmail !== undefined && typeof req.body.recipientEmail !== 'string') throw new ManagementError('Enter a valid email address.');
    const recipientEmail=req.body.recipientEmail?.trim().toLowerCase() || undefined;
    if (recipientEmail !== undefined && (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipientEmail) || recipientEmail.includes('\u0000'))) throw new ManagementError('Enter a valid email address.');
    const issuerId=`${MANAGER_ROLE}:${sessionUser(req).userId}`;
    const code=await issueInviteCode({isPlatformAdmin:true,issuerId,createdViaWeb:issuerId,comment:req.body.comment?.trim(),...(recipientEmail === undefined ? {} : {recipientEmail}),
      customCode:configuredInvitationCode()});
    res.json({code:code.code,createdAt:code.created_at,comment:code.comment??'',recipientEmail:code.recipient_email??'',onboardUrl:inviteOnboardUrl({origin:originFromRequest(req),code:code.code})});
  });
  // An explicit deny terminates all other manager paths and methods. It cannot
  // fall through into a framework admin handler or an account mutation.
  router.use((_req,res)=>{res.status(403).json({error:'This action is not available to velovest_manager.'});});
  router.use((error:unknown,_req:Request,res:import('express').Response,_next:import('express').NextFunction) => {
    if (error instanceof ManagementError || error instanceof SubmissionError) {res.status(error.status).json({error:error.message});return;}
    console.error('[management] operation failed');res.status(503).json({error:'Management is unavailable. Please retry.'});
  });
  return router;
}

/** The role is read live: assignment/revocation applies to existing sessions. */
export function managerManifest(getRepository: RepositorySource = managementRepository): RequestHandler {
  return async(req,res,next) => {
    let enabled=false;
    try {const user=sessionUser(req);enabled=user.type==='user'&&Boolean(user.userId)&&await getRepository().isManager(user.userId!);}
    catch { /* Keep private manager navigation unavailable when role lookup fails. */ }
    const json=res.json.bind(res);
    res.json=body=>{
      if (enabled && body && Array.isArray(body.nav) && Array.isArray(body.routes)) {
        body={...body,nav:[...body.nav,{id:'velovest-management',label:'Management',path:'/velovest-management',icon:'shield',order:20}],
          routes:[...body.routes,{path:'/velovest-management',pageKind:'iframe',iframeSrc:'/domain-assets/invage/management/index.html',title:'Management'}]};
      }
      return json(body);
    };
    res.setHeader('Cache-Control','private, no-store');next();
  };
}
