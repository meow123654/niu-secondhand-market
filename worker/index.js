const JSON_HEADERS={"content-type":"application/json; charset=utf-8","cache-control":"no-store"};
const allowedMedia={"image/jpeg":"jpg","image/png":"png","image/webp":"webp","image/gif":"gif","video/mp4":"mp4","video/webm":"webm","video/quicktime":"mov"};
const reply=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:JSON_HEADERS});

async function route(request,env){
  const url=new URL(request.url),path=url.pathname;
  if(request.method==="GET"&&path==="/")return new Response(env.ASSETS,{headers:{"content-type":"text/html; charset=utf-8","cache-control":"no-cache"}});
  if(request.method==="GET"&&path==="/manifest.webmanifest")return new Response(env.MANIFEST,{headers:{"content-type":"application/manifest+json; charset=utf-8","cache-control":"public, max-age=3600"}});
  if(path.startsWith("/uploads/")&&request.method==="GET"){
    const key=path.slice("/uploads/".length);if(!/^[a-f0-9-]{36}\.(jpg|png|webp|gif|mp4|webm|mov)$/.test(key))return new Response("Not found",{status:404});
    const object=await env.BUCKET.get(key);if(!object)return new Response("Not found",{status:404});
    return new Response(object.body,{headers:{"content-type":object.httpMetadata?.contentType||"application/octet-stream","cache-control":"public, max-age=31536000, immutable","x-content-type-options":"nosniff"}});
  }
  if(path==="/api/products"&&request.method==="GET"){
    const {results=[]}=await env.DB.prepare("SELECT * FROM products ORDER BY createdAt DESC").all();return reply(results);
  }
  if(path==="/api/products"&&request.method==="POST"){
    const p=await request.json().catch(()=>null),fields=["id","title","price","category","condition","seller","contact","location","description","image","emoji","status","createdAt","department","ownerId","mediaType"];
    if(!p||fields.slice(0,7).some(k=>p[k]===undefined||p[k]===null||p[k]===""))return reply({error:"商品資料不完整"},400);
    const cols=fields.join(","),values=fields.map(k=>p[k]??""),updates=fields.slice(1).map(k=>`${k}=excluded.${k}`).join(",");
    await env.DB.prepare(`INSERT INTO products (${cols}) VALUES (${fields.map(()=>"?").join(",")}) ON CONFLICT(id) DO UPDATE SET ${updates}`).bind(...values).run();return reply({ok:true});
  }
  const deletion=path.match(/^\/api\/products\/([\w-]+)$/);
  if(deletion&&request.method==="DELETE"){
    await env.DB.batch([env.DB.prepare("DELETE FROM messages WHERE product_id=?").bind(deletion[1]),env.DB.prepare("DELETE FROM products WHERE id=?").bind(deletion[1])]);return reply({ok:true});
  }
  const chat=path.match(/^\/api\/chats\/([\w-]+)$/);
  if(chat&&request.method==="GET"){
    const {results=[]}=await env.DB.prepare("SELECT * FROM messages WHERE product_id=? ORDER BY created_at").bind(chat[1]).all();return reply(results);
  }
  if(chat&&request.method==="POST"){
    const b=await request.json().catch(()=>null);if(!b)return reply({error:"訊息格式錯誤"},400);const body=String(b.body||"").trim(),media=String(b.media_url||"");if(!body&&!media)return reply({error:"請輸入訊息或選擇媒體"},400);
    const exists=await env.DB.prepare("SELECT id FROM products WHERE id=?").bind(chat[1]).first();if(!exists)return reply({error:"商品不存在"},404);
    const m={id:crypto.randomUUID(),product_id:chat[1],sender_id:String(b.sender_id||""),sender_name:String(b.sender_name||"訪客").slice(0,30),sender_department:String(b.sender_department||"").slice(0,60),body:body.slice(0,2000),media_url:media,media_type:String(b.media_type||""),created_at:new Date().toISOString()};
    await env.DB.prepare("INSERT INTO messages (id,product_id,sender_id,sender_name,sender_department,body,media_url,media_type,created_at) VALUES (?,?,?,?,?,?,?,?,?)").bind(m.id,m.product_id,m.sender_id,m.sender_name,m.sender_department,m.body,m.media_url,m.media_type,m.created_at).run();return reply(m,201);
  }
  if(path==="/api/inbox"&&request.method==="GET"){
    const user=url.searchParams.get("user_id")||"";
    const {results=[]}=await env.DB.prepare(`SELECT p.id,p.title,p.seller,p.department,p.image,p.mediaType,MAX(m.created_at) AS last_message,(SELECT body FROM messages WHERE product_id=p.id ORDER BY created_at DESC LIMIT 1) AS last_text FROM messages m JOIN products p ON p.id=m.product_id WHERE m.sender_id=? OR p.ownerId=? GROUP BY p.id ORDER BY last_message DESC`).bind(user,user).all();return reply(results);
  }
  if(path==="/api/upload"&&request.method==="POST"){
    const form=await request.formData(),file=form.get("file");if(!file||typeof file.arrayBuffer!=="function")return reply({error:"沒有選擇檔案"},400);const mime=file.type||"";if(!allowedMedia[mime])return reply({error:"僅支援 JPG、PNG、WebP、GIF、MP4、WebM 或 MOV"},415);if(file.size>80*1024*1024)return reply({error:"檔案超過 80 MB，請先壓縮後再上傳"},413);
    const key=`${crypto.randomUUID()}.${allowedMedia[mime]}`;await env.BUCKET.put(key,await file.arrayBuffer(),{httpMetadata:{contentType:mime}});return reply({url:`/uploads/${key}`,media_type:mime.startsWith("video/")?"video":"image"});
  }
  return new Response("Not found",{status:404});
}

export default {async fetch(request,env){try{return await route(request,env)}catch(error){console.error("Request failed",error);return reply({error:"伺服器暫時無法處理，請稍後再試"},500)}}};
