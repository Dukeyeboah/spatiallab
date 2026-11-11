"""Blender 3.6+: one complete modeling pass, GLB export and three studio renders.
Run with Blender --background --python this_file, or exec() in its Python console.
Builds an isolated scene; existing user scenes/files are never overwritten.
ORB_OUTPUT_DIR and ORB_ASSET_DIR may override the delivery/runtime locations.
"""
import bpy, math, os, json, traceback
from pathlib import Path
from mathutils import Vector
from math import sin, cos, pi, sqrt
OUT = Path(os.environ.get('ORB_OUTPUT_DIR', '/Users/duke/Documents/Codex/2026-11-08/i-x20/outputs/orb-assistant-v1'))
ASSETS = Path(os.environ.get('ORB_ASSET_DIR', '/Users/duke/Documents/GitHub/SpatialLab/public/labs/prod02b/avatars/robots'))
OUT.mkdir(parents=True, exist_ok=True); ASSETS.mkdir(parents=True, exist_ok=True)
STATUS = OUT / 'build-status.json'
def progress(stage): STATUS.write_text(json.dumps({'stage':stage})); print('ORB_V1:',stage,flush=True)
def srgb(h):
    values=[int(h[i:i+2],16)/255 for i in (0,2,4)]
    return tuple(v/12.92 if v<=.04045 else ((v+.055)/1.055)**2.4 for v in values)
def build():
    progress('modeling')
    # Re-running this script is the single optional refinement; remove only our isolated scene.
    old=bpy.data.scenes.get('ORB_ASSISTANT_V1')
    if old:
        for obj in list(old.objects):bpy.data.objects.remove(obj,do_unlink=True)
        other=next((s for s in bpy.data.scenes if s!=old),None)
        if other:bpy.context.window.scene=other
        bpy.data.scenes.remove(old)
        for name in ['ORB_ASSISTANT','ORB_STUDIO']:
            col=bpy.data.collections.get(name)
            if col:bpy.data.collections.remove(col)
        for m in list(bpy.data.materials):
            if m.users==0 and (m.name.split('.')[0] in {'MAT_ShellWhite','MAT_VisorDark','MAT_CyanGlow','MAT_Accent'} or m.name.startswith('STUDIO_')):bpy.data.materials.remove(m)
    scene=bpy.data.scenes.new('ORB_ASSISTANT_V1')
    bpy.context.window.scene=scene
    scene.unit_settings.system='METRIC'; scene.unit_settings.scale_length=1
    robot=bpy.data.collections.new('ORB_ASSISTANT'); scene.collection.children.link(robot)
    studio=bpy.data.collections.new('ORB_STUDIO'); scene.collection.children.link(studio)
    def material(name,h,metal,rough,emission=0):
        m=bpy.data.materials.new(name); m.use_nodes=True
        p=m.node_tree.nodes.get('Principled BSDF'); color=srgb(h)
        p.inputs['Base Color'].default_value=(*color,1);p.inputs['Metallic'].default_value=metal;p.inputs['Roughness'].default_value=rough
        if emission:
            p.inputs['Emission'].default_value=(*color,1);p.inputs['Emission Strength'].default_value=emission
        m.diffuse_color=(*color,1);return m
    white=material('MAT_ShellWhite','F2F0EA',.06,.30)
    dark=material('MAT_VisorDark','101C23',.05,.19)
    cyan=material('MAT_CyanGlow','42EAF2',0,.28,3.0)
    accent=material('MAT_Accent','AE8650',.6,.31)
    def empty(name,parent=None,loc=(0,0,0)):
        o=bpy.data.objects.new(name,None);robot.objects.link(o);o.parent=parent;o.location=loc;o.empty_display_size=.025;return o
    root=empty('ORB_ROOT'); root['role']='Navigation origin; never animated locally'
    visual=empty('VisualRoot',root,(0,0,.27));visual['role']='Procedural bob, lean and bank; body center 0.27m above ground'
    def mesh(name,verts,faces,mat,parent=visual):
        m=bpy.data.meshes.new(name+'_Mesh');m.from_pydata(verts,[],faces);m.update()
        o=bpy.data.objects.new(name,m);robot.objects.link(o);o.parent=parent;m.materials.append(mat)
        for p in m.polygons:p.use_smooth=True
        return o
    def uv_sphere(name,radii,segments,rings,mat,loc=(0,0,0)):
        v=[(0,0,radii[2])];f=[]
        for j in range(1,rings):
            t=pi*j/rings
            for i in range(segments):
                a=2*pi*i/segments;v.append((radii[0]*sin(t)*cos(a),radii[1]*sin(t)*sin(a),radii[2]*cos(t)))
        bottom=len(v);v.append((0,0,-radii[2]))
        for i in range(segments):f.append((0,1+i,1+(i+1)%segments))
        for j in range(rings-2):
            a=1+j*segments;b=a+segments
            for i in range(segments):k=(i+1)%segments;f.append((a+i,b+i,b+k,a+k))
        a=1+(rings-2)*segments
        for i in range(segments):f.append((a+i,bottom,a+(i+1)%segments))
        o=mesh(name,v,f,mat);o.location=loc;return o
    body=uv_sphere('BodyShell',(.12,.12,.12),32,16,white)
    # A shaped, convex visor follows the actual shell surface; no boolean or internals.
    def face_point(x,z,offset=.002):return (x,-sqrt(max(.0001,.12**2-x*x-z*z))-offset,z)
    count=40;rings=6;v=[face_point(0,-.012)];f=[]
    for j in range(1,rings+1):
        r=j/rings
        for i in range(count):
            a=2*pi*i/count;ca=cos(a);sa=sin(a)
            x=.091*math.copysign(abs(ca)**(2/2.65),ca)
            z=.082*math.copysign(abs(sa)**(2/2.65),sa)
            if z>0:z-=.025*math.exp(-(x/.045)**4)
            v.append(face_point(x*r,-.012+z*r))
    for i in range(count):f.append((0,1+(i+1)%count,1+i))
    for j in range(rings-1):
        a=1+j*count;b=a+count
        for i in range(count):k=(i+1)%count;f.append((a+i,a+k,b+k,b+i))
    visor=mesh('FaceVisor',v,f,dark)
    # Thin panel lip is part of the same visible visor mesh, not a hidden backing.
    def tube(name,points,radius,sides,mat,parent=visual,normal_hint=None):
        v=[];f=[];n=len(points)
        for i,p in enumerate(points):
            p=Vector(p);t=(Vector(points[(i+1)%n])-Vector(points[(i-1)%n])).normalized()
            hint=Vector(normal_hint) if normal_hint else Vector((p.x,p.y,p.z)).normalized()
            normal=(hint-t*hint.dot(t)).normalized();lateral=t.cross(normal).normalized()
            for j in range(sides):
                a=2*pi*j/sides;v.append(tuple(p+radius*(normal*cos(a)+lateral*sin(a))))
        for i in range(n):
            for j in range(sides):a=i*sides+j;b=i*sides+(j+1)%sides;c=((i+1)%n)*sides+(j+1)%sides;d=((i+1)%n)*sides+j;f.append((a,b,c,d))
        return mesh(name,v,f,mat,parent)
    for side,name in [(-1,'Eye_L'),(1,'Eye_R')]:
        pts=[]
        for i in range(24):
            a=2*pi*i/24;x=side*.036+.018*cos(a);z=.005+.018*sin(a);pts.append(face_point(x,z,.005))
        tube(name,pts,.0024,6,cyan)
    # Curved crown panel with a very thin charcoal perimeter; all visible geometry.
    v=[(0,-.015,.123)];f=[];segments=32;radial=3
    for j in range(1,radial+1):
        r=j/radial
        for i in range(segments):
            a=2*pi*i/segments;x=.046*math.copysign(abs(cos(a))**.65,cos(a))*r;y=-.015+.035*math.copysign(abs(sin(a))**.65,sin(a))*r
            v.append((x,y,sqrt(.12**2-x*x-y*y)+.003))
    for i in range(segments):f.append((0,1+i,1+(i+1)%segments))
    for j in range(radial-1):
        a=1+j*segments;b=a+segments
        for i in range(segments):k=(i+1)%segments;f.append((a+i,b+i,b+k,a+k))
    cap=mesh('TopCap',v,f,white)
    # Front arch light follows the crown curvature, one very slim closed strip.
    strip=[]
    for i in range(16):
        x=-.032+.064*i/15;y=-.047+.006*(x/.032)**2;z=sqrt(.12**2-x*x-y*y)+.004;strip.append((x,y,z))
    # A flattened loop gives the strip rounded ends without a costly curve modifier.
    strip += [(x,y+.0016,z+.0005)for x,y,z in reversed(strip)]
    tube('CapLight',strip,.00065,4,cyan,normal_hint=(0,-.4,1))
    for sign,side in [(-1,'L'),(1,'R')]:
        pivot=empty('FinPivot_'+side,visual,(sign*.108,0,-.023))
        direction=Vector((sign*.050,0,-.065)).normalized();across=Vector((direction.z,0,-direction.x)).normalized()
        seg=16;rings=10;v=[(0,0,0)];f=[]
        for j in range(1,rings):
            t=j/rings;profile=sin(pi*t)**.72
            for i in range(seg):
                a=2*pi*i/seg;p=direction*(.080*t)+across*(.020*profile*cos(a))+Vector((0,.016*t+.0195*profile*sin(a),0));v.append(tuple(p))
        bottom=len(v);v.append(tuple(direction*.08+Vector((0,.016,0))))
        for i in range(seg):f.append((0,1+(i+1)%seg,1+i))
        for j in range(rings-2):
            a=1+j*seg;b=a+seg
            for i in range(seg):k=(i+1)%seg;f.append((a+i,a+k,b+k,b+i))
        a=1+(rings-2)*seg
        for i in range(seg):f.append((a+i,a+(i+1)%seg,bottom))
        fin=mesh('Fin_'+side,v,f,white,pivot)
        # Inset-looking front light, parented to the fin so it shares its pivot.
        pts=[]
        for j in range(10):
            t=.20+.48*j/9;p=direction*(.080*t)+Vector((0,.016*t-.0195*sin(pi*t)**.72-.0008,0));pts.append(tuple(p))
        pts += [tuple(Vector(p)+across*.0012) for p in reversed(pts)]
        tube('FinLight_'+side,pts,.00065,4,cyan,fin,normal_hint=(0,-1,0))
    pts=[(.028*cos(2*pi*i/24),.028*sin(2*pi*i/24),-.131)for i in range(24)]
    tube('HoverRing',pts,.003,6,cyan,normal_hint=(0,0,-1))
    # Visible underside mount: two rings and faces, no internal machinery.
    v=[];f=[]
    for z,r in [(-.122,.030),(-.128,.032)]:
        for i in range(24):a=2*pi*i/24;v.append((r*cos(a),r*sin(a),z))
    for i in range(24):j=(i+1)%24;f.append((i,j,24+j,24+i))
    f.append(tuple(range(24,48)));f.append(tuple(reversed(range(24))));mesh('HoverMount',v,f,dark)
    # Two tiny warm-metal marks, kept on the visible exterior.
    for sign,label in [(-1,'L'),(1,'R')]:
        x=sign*.082;z=.078;p=face_point(x,z,.003)
        o=uv_sphere('Accent_'+label,(.0018,.001,.004),8,4,accent,p)
        o.rotation_euler[1]=sign*.45
    root['description']='Spatial Labs Orb Assistant V1; body 24 cm, no bones/textures/internal parts'
    root['front']='Blender -Y; GLB +Z';visual['rest_height_m']=.27
    bpy.context.view_layer.update()
    # Use explicit triangulation for reproducible counts and predictable GLB export.
    for obj in robot.objects:
        if obj.type=='MESH':
            import bmesh
            bm=bmesh.new();bm.from_mesh(obj.data);bmesh.ops.recalc_face_normals(bm,faces=list(bm.faces));
            if obj.name=='FaceVisor' and sum(f.normal.y for f in bm.faces)>0:bmesh.ops.reverse_faces(bm,faces=list(bm.faces))
            bm.to_mesh(obj.data);bm.free()
            obj.data.calc_loop_triangles()
    objects=[o for o in robot.objects if o.type=='MESH']
    triangles=sum(len(o.data.loop_triangles)for o in objects)
    assert triangles<=5000,triangles
    assert len(objects)<15,len(objects)
    assert len({m for o in objects for m in o.data.materials})<=4
    # Select only the robot hierarchy. Studio camera/lights/floor never enter GLB.
    bpy.ops.object.select_all(action='DESELECT')
    for o in robot.objects:o.select_set(True)
    bpy.context.view_layer.objects.active=root
    glb=OUT/'spatial-orb-assistant-v1.glb'
    bpy.ops.export_scene.gltf(filepath=str(glb),export_format='GLB',use_selection=True,export_yup=True,export_animations=False,export_cameras=False,export_lights=False,export_apply=False,export_extras=True)
    (ASSETS/glb.name).write_bytes(glb.read_bytes())
    meta={'triangles':triangles,'meshObjects':len(objects),'materials':4,'bones':0,'textures':0,'bytes':glb.stat().st_size,'bodyDiameterM':.24,'restBodyCenterM':.27,'front':'GLB +Z','clips':[],'animation':'Procedural VisualRoot + FinPivot_L / FinPivot_R; no skeletal rig'}
    (OUT/'spatial-orb-assistant-v1.meta.json').write_text(json.dumps(meta,indent=2));(ASSETS/'spatial-orb-assistant-v1.meta.json').write_text(json.dumps(meta,indent=2))
    progress('rendering')
    # Presentation stage is excluded from exports and from the ORB_ASSISTANT collection.
    def studio_obj(obj):
        for c in list(obj.users_collection):c.objects.unlink(obj)
        studio.objects.link(obj);return obj
    floor_mat=material('STUDIO_Matte','B8B3AF',0,.8)
    plane=mesh('STUDIO_Floor',[(-200,-200,0),(200,-200,0),(200,200,0),(-200,200,0)],[(0,1,2,3)],floor_mat,None);robot.objects.unlink(plane);studio.objects.link(plane)
    world=bpy.data.worlds.new('ORB_STUDIO_World');world.use_nodes=True;world.node_tree.nodes['Background'].inputs['Color'].default_value=(.14,.16,.18,1);world.node_tree.nodes['Background'].inputs['Strength'].default_value=.35;scene.world=world
    def light(name,loc,power,size,color):
        data=bpy.data.lights.new(name,'AREA');data.energy=power;data.shape='DISK';data.size=size;data.color=color;o=bpy.data.objects.new(name,data);studio.objects.link(o);o.location=loc;o.rotation_euler=(Vector((0,0,.25))-o.location).to_track_quat('-Z','Y').to_euler()
    light('STUDIO_Key',(-.55,-.65,.95),12,.6,(1,.94,.87));light('STUDIO_Fill',(.6,-.1,.55),6,.5,(.75,.88,1));light('STUDIO_Rim',(-.1,.45,.7),12,.4,(1,1,1))
    cam_data=bpy.data.cameras.new('STUDIO_Camera');cam=bpy.data.objects.new('STUDIO_Camera',cam_data);studio.objects.link(cam);cam_data.type='ORTHO';cam_data.ortho_scale=.55;scene.camera=cam
    scene.render.engine='CYCLES';scene.cycles.device='CPU';scene.cycles.samples=40;scene.cycles.use_denoising=True
    scene.render.resolution_x=1000;scene.render.resolution_y=1000;scene.render.resolution_percentage=100;scene.render.image_settings.file_format='PNG';scene.render.film_transparent=False
    scene.view_settings.view_transform='Filmic';scene.view_settings.look='Medium High Contrast';scene.view_settings.exposure=0;scene.view_settings.gamma=1
    scene.use_nodes=True;tree=scene.node_tree;tree.nodes.clear();rl=tree.nodes.new('CompositorNodeRLayers');glow=tree.nodes.new('CompositorNodeGlare');glow.glare_type='FOG_GLOW';glow.quality='MEDIUM';glow.threshold=1.8;glow.size=7;out=tree.nodes.new('CompositorNodeComposite');tree.links.new(rl.outputs['Image'],glow.inputs['Image']);tree.links.new(glow.outputs['Image'],out.inputs['Image'])
    # Presentation equivalent of the separate runtime projection; never exported to GLB.
    glowmat=bpy.data.materials.new('STUDIO_GroundProjection');glowmat.use_nodes=True
    nt=glowmat.node_tree;nt.nodes.clear();uv=nt.nodes.new('ShaderNodeTexCoord');subtract=nt.nodes.new('ShaderNodeVectorMath');subtract.operation='SUBTRACT';subtract.inputs[1].default_value=(.5,.5,0);nt.links.new(uv.outputs['UV'],subtract.inputs[0]);length=nt.nodes.new('ShaderNodeVectorMath');length.operation='LENGTH';nt.links.new(subtract.outputs[0],length.inputs[0]);minus=nt.nodes.new('ShaderNodeMath');minus.operation='SUBTRACT';minus.inputs[1].default_value=.24;nt.links.new(length.outputs['Value'],minus.inputs[0]);power=nt.nodes.new('ShaderNodeMath');power.operation='MULTIPLY';nt.links.new(minus.outputs[0],power.inputs[0]);nt.links.new(minus.outputs[0],power.inputs[1]);mul=nt.nodes.new('ShaderNodeMath');mul.operation='MULTIPLY';mul.inputs[1].default_value=-3000;nt.links.new(power.outputs[0],mul.inputs[0]);exp=nt.nodes.new('ShaderNodeMath');exp.operation='EXPONENT';nt.links.new(mul.outputs[0],exp.inputs[0]);fade=nt.nodes.new('ShaderNodeMath');fade.operation='MULTIPLY';fade.inputs[1].default_value=.45;nt.links.new(exp.outputs[0],fade.inputs[0]);transparent=nt.nodes.new('ShaderNodeBsdfTransparent');emission=nt.nodes.new('ShaderNodeEmission');emission.inputs['Color'].default_value=(*srgb('42EAF2'),1);emission.inputs['Strength'].default_value=2;mix=nt.nodes.new('ShaderNodeMixShader');nt.links.new(fade.outputs[0],mix.inputs[0]);nt.links.new(transparent.outputs[0],mix.inputs[1]);nt.links.new(emission.outputs[0],mix.inputs[2]);output=nt.nodes.new('ShaderNodeOutputMaterial');nt.links.new(mix.outputs[0],output.inputs[0])
    ground=mesh('STUDIO_GroundProjection',[(-.08,-.08,.001),(.08,-.08,.001),(.08,.08,.001),(-.08,.08,.001)],[(0,1,2,3)],glowmat,None);robot.objects.unlink(ground);studio.objects.link(ground)
    layer=ground.data.uv_layers.new(name='UVMap')
    for i,co in enumerate([(0,0),(1,0),(1,1),(0,1)]):layer.data[i].uv=co
    # No floor-glow mesh in the asset: the renderer creates it at runtime.
    for name,pos in [('front',(0,-1.1,.32)),('side',(1.1,0,.32)),('three-quarter',(.72,-1.05,.65))]:
        cam.location=pos;cam.rotation_euler=(Vector((0,0,.215))-cam.location).to_track_quat('-Z','Y').to_euler();scene.render.filepath=str(OUT/('orb-'+name+'.png'));bpy.ops.render.render(write_still=True);progress('rendered '+name)
    # Return to the useful presentation view and save only this scene/dependencies.
    bpy.ops.object.select_all(action='DESELECT');root.select_set(True);bpy.context.view_layer.objects.active=root
    bpy.data.libraries.write(str(OUT/'spatial-orb-assistant-v1.blend'),{scene},fake_user=True,compress=True)
    progress('complete')
try:build()
except Exception:
    STATUS.write_text(json.dumps({'stage':'error','traceback':traceback.format_exc()}));raise
