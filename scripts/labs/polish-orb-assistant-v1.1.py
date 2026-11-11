"""Refine a copied V1 .blend. Never regenerate or overwrite V1.
Execute in Blender's Python console; studio is inherited unchanged from V1.
"""
import bpy, bmesh, math, json, traceback, shutil, tempfile
from pathlib import Path
from mathutils import Vector
from math import sin, cos, pi, sqrt
REPO=Path('/Users/duke/Documents/GitHub/SpatialLab')
OUT=Path('/Users/duke/Documents/Codex/2026-11-08/i-x20/outputs/orb-assistant-v1.1')
STEM='spatial-orb-assistant-v1.1'
def status(s):
 (OUT/'build-status.json').write_text(json.dumps({'stage':s}));print('ORB_V1.1:',s,flush=True)
def polish():
 status('loading V1.1 copy')
 # Always copy the immutable V1 input before opening it for this polish pass.
 with tempfile.TemporaryDirectory(prefix='orb-v1.1-source-') as stage:
  source_copy=Path(stage)/(STEM+'.blend')
  shutil.copy2(REPO/'source-data/avatars/spatial-orb-assistant-v1.blend',source_copy)
  with bpy.data.libraries.load(str(source_copy),link=False) as (src,dst): dst.scenes=[src.scenes[0]]
 scene=dst.scenes[0];scene.name='ORB_ASSISTANT_V1_1';bpy.context.window.scene=scene
 # Temporarily disambiguate live V1 names; its files and datablocks remain untouched.
 names={o.name.split('.')[0]:o for o in scene.objects};renamed=[]
 for name,o in names.items():
  other=bpy.data.objects.get(name)
  if other and other!=o:renamed.append((other,name));other.name='V1_VIEW_'+name
  o.name=name
 robot=next(c for c in scene.collection.children if c.name.startswith('ORB_ASSISTANT'))
 mats={m.name.split('.')[0]:m for o in robot.objects if o.type=='MESH' for m in o.data.materials}
 white,dark,cyan,bronze=[mats[n] for n in ['MAT_ShellWhite','MAT_VisorDark','MAT_CyanGlow','MAT_Accent']]
 white.node_tree.nodes['Principled BSDF'].inputs['Roughness'].default_value=.33
 dark.node_tree.nodes['Principled BSDF'].inputs['Roughness'].default_value=.22
 cyan.node_tree.nodes['Principled BSDF'].inputs['Emission Strength'].default_value=2.2
 def append(o,verts,faces,material):
  old=o.data;vs=[tuple(v.co) for v in old.vertices];fs=[tuple(p.vertices) for p in old.polygons];mi=[p.material_index for p in old.polygons]
  materials=list(old.materials)
  if material not in materials:materials.append(material)
  idx=materials.index(material);offset=len(vs);vs+=list(verts);fs += [tuple(offset+i for i in f) for f in faces];mi += [idx]*len(faces)
  mesh=bpy.data.meshes.new(o.name+'_PolishedMesh');mesh.from_pydata(vs,[],fs);mesh.update()
  for m in materials:mesh.materials.append(m)
  for p,i in zip(mesh.polygons,mi):p.material_index=i;p.use_smooth=True
  o.data=mesh
 def tube(o,points,radius,sides,material,normal_hint=None,closed=True):
  v=[];f=[];n=len(points)
  for i,p in enumerate(points):
   p=Vector(p);t=(Vector(points[(i+1)%n] if closed or i<n-1 else points[i])-Vector(points[(i-1)%n] if closed or i>0 else points[i])).normalized()
   hint=Vector(normal_hint) if normal_hint else p.normalized();normal=(hint-t*hint.dot(t)).normalized();lateral=t.cross(normal).normalized()
   for j in range(sides):a=2*pi*j/sides;v.append(tuple(p+radius*(normal*cos(a)+lateral*sin(a))))
  for i in range(n if closed else n-1):
   for j in range(sides):a=i*sides+j;b=i*sides+(j+1)%sides;c=((i+1)%n)*sides+(j+1)%sides;d=((i+1)%n)*sides+j;f.append((a,b,c,d))
  append(o,v,f,material)
 def face(x,z,offset=.0018):return (x,-sqrt(max(.0001,.12**2-x*x-z*z))-offset,z)
 def boundary(a):
  ca,sa=cos(a),sin(a);x=.091*math.copysign(abs(ca)**(2/2.35),ca);z=.082*math.copysign(abs(sa)**(2/2.35),sa)
  if z>0:z-=.021*math.exp(-(x/.047)**4)
  return x,-.012+z
 visor=names['FaceVisor']
 # Reshape every original vertex, keeping the six-ring surface topology.
 visor.data.vertices[0].co=face(0,-.012)
 for j in range(1,7):
  for i in range(40):
   x,z=boundary(2*pi*i/40);r=j/6;visor.data.vertices[1+(j-1)*40+i].co=face(x*r,-.012+(z+.012)*r)
 # Split only the outer boundary edges, avoiding a subdivision modifier.
 bm=bmesh.new();bm.from_mesh(visor.data);bm.verts.ensure_lookup_table();perimeter=set(range(201,241));edges=[e for e in bm.edges if all(v.index in perimeter for v in e.verts)]
 bmesh.ops.subdivide_edges(bm,edges=edges,cuts=1,use_grid_fill=False)
 for v in bm.verts:
  if v.index<0 or v.index>=241:
   # Midpoints projected back onto the analytic contour rather than a polygon chord.
   a=math.atan2((v.co.z+.012)/.082,v.co.x/.091)
   # Closest angular half-step to this edge's midpoint.
   candidates=[(2*i+1)*pi/40 for i in range(40)]
   a=min(candidates,key=lambda a:(Vector(face(*boundary(a)))-v.co).length)
   v.co=face(*boundary(a))
 bmesh.ops.recalc_face_normals(bm,faces=list(bm.faces))
 if sum(f.normal.y for f in bm.faces)>0:bmesh.ops.reverse_faces(bm,faces=list(bm.faces))
 bm.to_mesh(visor.data);bm.free()
 tube(visor,[face(*boundary(2*pi*i/80),.0013) for i in range(80)],.00075,3,dark)
 # Lens surfaces and restrained reflected glints are joined into the eye meshes.
 for sign,side in [(-1,'L'),(1,'R')]:
  eye=names['Eye_'+side]
  for v in eye.data.vertices:
   x,z=v.co.x,v.co.z;v.co.y+=.0002
  centerx=sign*.036;centerz=.005
  v=[face(centerx,centerz,.0052)];f=[]
  for i in range(24):
   a=2*pi*i/24;v.append(face(centerx+.0147*cos(a),centerz+.0147*sin(a),.0037))
  for i in range(24):f.append((0,1+(i+1)%24,1+i))
  append(eye,v,f,dark)
  glint=[]
  for i in range(9):
   a=.35+1.0*i/8;glint.append(face(centerx+.012*cos(a),centerz+.012*sin(a),.006))
  tube(eye,glint,.00055,4,white,normal_hint=(0,-1,0),closed=False)
 # A narrow dark seam under the existing cap; same crown and light strip.
 cap=names['TopCap'];cappts=[]
 for v in cap.data.vertices[-32:]:
  x,y,z=v.co;cappts.append((x,y,z-.001))
 tube(cap,cappts,.0006,3,dark,normal_hint=(0,0,1))
 for sign,side in [(-1,'L'),(1,'R')]:
  fin=names['Fin_'+side];direction=Vector((sign*.050,0,-.065)).normalized();across=Vector((direction.z,0,-direction.x)).normalized()
  # Blunter shoulder, flatter front and compact taper: edit existing fin vertices.
  for j in range(1,10):
   t=j/10;profile=sin(pi*t)**.50
   for i in range(16):
    a=2*pi*i/16;p=direction*(.078*t)+across*(.020*profile*cos(a))+Vector((0,.012*t+.0165*profile*sin(a),0));fin.data.vertices[1+(j-1)*16+i].co=p
  fin.data.vertices[-1].co=direction*.078+Vector((0,.012,0))
  # Keep the existing light mesh aligned to the reshaped surface.
  light=names['FinLight_'+side]
  for i,vertex in enumerate(light.data.vertices):
   pathIndex=i//4;t=.20+.48*(pathIndex if pathIndex<10 else 19-pathIndex)/9
   old=direction*(.080*t)+Vector((0,.016*t-.0195*sin(pi*t)**.72-.0008,0))
   new=direction*(.078*t)+Vector((0,.012*t-.0165*sin(pi*t)**.50-.0008,0))
   vertex.co+=new-old
  # Low-profile external joint, merged into the existing animated fin mesh.
  v=[];f=[];n=16
  for x,r in [(sign*.005,.0105),(sign*.016,.011),(sign*.019,.0085)]:
   for i in range(n):a=2*pi*i/n;v.append((x,r*cos(a),r*sin(a)))
  for j in range(2):
   for i in range(n):k=(i+1)%n;f.append((j*n+i,j*n+k,(j+1)*n+k,(j+1)*n+i))
  f.append(tuple(range(32,48)))
  append(fin,v,f,dark)
 # Seat the original underside disc into the shell, ring against the lower lip.
 mount=names['HoverMount']
 for v in mount.data.vertices:v.co.z+=.008
 for v in names['HoverRing'].data.vertices:v.co.z+=.008
 root=names['ORB_ROOT'];root['description']='Spatial Labs Orb Assistant V1.1; refined V1 surfaces, 24 cm body, no rigs/textures'
 bpy.context.view_layer.update()
 for o in robot.objects:
  if o.type=='MESH':o.data.update();o.data.calc_loop_triangles()
 meshes=[o for o in robot.objects if o.type=='MESH'];tri=sum(len(o.data.loop_triangles)for o in meshes)
 assert tri<=5000,tri
 assert len(meshes)==14,len(meshes)
 bpy.ops.object.select_all(action='DESELECT')
 for o in robot.objects:o.select_set(True)
 bpy.context.view_layer.objects.active=root
 status('exporting refined V1.1')
 glb=OUT/(STEM+'.glb')
 bpy.ops.export_scene.gltf(filepath=str(glb),export_format='GLB',use_selection=True,export_yup=True,export_animations=False,export_cameras=False,export_lights=False,export_apply=False,export_extras=True)
 assert glb.stat().st_size<150000
 meta={'version':'1.1','source':'Refined copy of spatial-orb-assistant-v1.blend','triangles':tri,'meshObjects':len(meshes),'materials':4,'bones':0,'textures':0,'bytes':glb.stat().st_size,'bodyDiameterM':.24,'restBodyCenterM':.27,'front':'GLB +Z','clips':[],'hierarchyChanges':[],'animation':'Existing procedural VisualRoot + FinPivot_L/R unchanged; eye lenses, seams and fin joints joined into existing meshes'}
 (OUT/(STEM+'.meta.json')).write_text(json.dumps(meta,indent=2))
 assetdir=REPO/'public/labs/prod02b/avatars/robots'
 for suffix in ['.glb','.meta.json']:shutil.copy2(OUT/(STEM+suffix),assetdir/(STEM+suffix))
 cam=scene.camera
 for label,pos in [('front',(0,-1.1,.32)),('side',(1.1,0,.32)),('three-quarter',(.72,-1.05,.65))]:
  status('rendering '+label);cam.location=pos;cam.rotation_euler=(Vector((0,0,.215))-cam.location).to_track_quat('-Z','Y').to_euler();scene.render.filepath=str(OUT/('orb-'+label+'.png'));bpy.ops.render.render(write_still=True)
 bpy.data.libraries.write(str(OUT/(STEM+'.blend')),{scene},fake_user=True,compress=True)
 shutil.copy2(OUT/(STEM+'.blend'),REPO/'source-data/avatars'/(STEM+'.blend'))
 with bpy.data.libraries.load(str(OUT/(STEM+'.blend'))) as (source,target):
  (OUT/'blend-verification.json').write_text(json.dumps({'scenes':source.scenes,'objects':source.objects,'materials':source.materials},indent=2))
 for o,name in renamed:o.name=name
 status('complete')
try:polish()
except Exception:
 (OUT/'build-status.json').write_text(json.dumps({'stage':'error','traceback':traceback.format_exc()}));raise
