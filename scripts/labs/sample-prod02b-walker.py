"""Run in Blender 3.6's Python console, without saving the source blend.
Set SPATIAL_ROBOT_SOURCE and SPATIAL_ROBOT_OUTPUT environment variables to override.
The evaluated mirror mesh and IK poses are sampled; subdivision is omitted.
"""
import bpy,json,traceback,os
from pathlib import Path
OUT=Path(os.environ.get('SPATIAL_ROBOT_OUTPUT', '/tmp/spatial-robot-samples'));OUT.mkdir(parents=True,exist_ok=True)
try:
 bpy.ops.wm.open_mainfile(filepath=os.environ.get('SPATIAL_ROBOT_SOURCE',str(Path.home()/'Downloads/robot.blend')),load_ui=False,use_scripts=False)
 scene=bpy.context.scene;arm=next(o for o in scene.objects if o.type=='ARMATURE');obj=next(o for o in scene.objects if o.type=='MESH')
 for tr in arm.animation_data.nla_tracks:tr.mute=True
 for mod in obj.modifiers:
  if mod.type=='SUBSURF':mod.show_viewport=False;mod.show_render=False
 arm.data.pose_position='REST';scene.frame_set(1);bpy.context.view_layer.update();deps=bpy.context.evaluated_depsgraph_get();ev=obj.evaluated_get(deps);mesh=ev.to_mesh(preserve_all_data_layers=True,depsgraph=deps);mesh.calc_loop_triangles();mesh.calc_normals_split()
 data={'meshMatrix':[v for row in obj.matrix_world for v in row],'positions':[list(v.co)for v in mesh.vertices],'weights':[[[g.group,g.weight]for g in v.groups]for v in mesh.vertices],'groups':[g.name for g in obj.vertex_groups],'triangles':[{'vertices':list(t.vertices),'normals':[list(mesh.loops[i].normal)for i in t.loops],'material':t.material_index}for t in mesh.loop_triangles],'materials':[m.name for m in obj.data.materials],'bones':[{'name':b.name,'parent':b.parent.name if b.parent else None,'matrix':[v for row in (arm.matrix_world@b.matrix_local)for v in row]}for b in arm.data.bones],'actions':{}}
 ev.to_mesh_clear();arm.data.pose_position='POSE'
 for name,frames in [('Idle',range(1,26)),('Walk',range(1,36))]:
  arm.animation_data.action=bpy.data.actions[name];samples=[]
  for frame in frames:
   scene.frame_set(frame);bpy.context.view_layer.update();pose=arm.evaluated_get(bpy.context.evaluated_depsgraph_get());samples.append({'time':(frame-1)/24,'bones':{b.name:[v for row in (arm.matrix_world@b.matrix)for v in row]for b in pose.pose.bones}})
  data['actions'][name]=samples
 (OUT/'walker-sampled.json').write_text(json.dumps(data));(OUT/'sample-status.txt').write_text('SAMPLED_OK');print('SAMPLED_OK')
except Exception:(OUT/'sample-error.txt').write_text(traceback.format_exc());print('SAMPLE_FAILED')
