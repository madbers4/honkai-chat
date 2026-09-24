"""Repair and export the supplied Automaton Beetle as a mobile-ready rigid skin.
Run with Blender 4.3+: blender -b assets-source/original/source/Automaton-Beetle.blend --python scripts/prepare-model.py
Original files are never modified. No invented geometry replaces the user's robot.
"""
import bpy, os, json, math
from mathutils import Vector, Matrix

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'public', 'assets')
SOURCE = os.path.join(ROOT, 'assets-source')
os.makedirs(OUT, exist_ok=True)
os.makedirs(os.path.join(SOURCE,'optimized-textures'),exist_ok=True)

old_arm = bpy.data.objects['Armature']
old_meshes = [o for o in bpy.data.objects if o.type == 'MESH']
corners = [o.matrix_world @ Vector(c) for o in old_meshes for c in o.bound_box]
floor = min(v.z for v in corners)
scale = 2.4 / (max(v.z for v in corners) - floor)
normalize = Matrix.Scale(scale,4) @ Matrix.Translation((0,0,-floor))
legs = {
    'FR':['Bone.001','Bone.002','Bone.003','Bone.005'],
    'RR':['Bone.004','Bone.007','Bone.008','Bone.009'],
    'RL':['Bone.011','Bone.012','Bone.013','Bone.014'],
    'FL':['Bone.016','Bone.017','Bone.018','Bone.019'],
}
mapping = {'Bone':'chassis'}
for side,names in legs.items():
    for old,part in zip(names,['hip','knee','ankle','foot']): mapping[old]=f'leg_{side}_{part}'
bones = {}
for b in old_arm.data.bones:
    if b.name not in mapping: continue
    bones[mapping[b.name]] = {
        'head':normalize @ old_arm.matrix_world @ b.head_local,
        'tail':normalize @ old_arm.matrix_world @ b.tail_local,
        'parent':mapping.get(b.parent.name) if b.parent else None,
    }
bones['turret']={'head':normalize @ Vector((0,0,2.50)), 'tail':normalize @ Vector((0,0,4.70)), 'parent':'chassis'}

def side_for(name, location):
    return ('F' if location.y<0 else 'R') + ('R' if location.x>0 else 'L')

def bind_for(ob):
    # Complete the source's partially bone-parented assembly: bolts and toe shells
    # must follow the same link as their neighboring rigid parts.
    side=side_for(ob.name,ob.matrix_world.translation)
    if ob.name.startswith(('leg.end','leg.bolt')): return f'leg_{side}_foot' if ob.name.startswith('leg.end') else f'leg_{side}_ankle'
    if ob.name.startswith('joint.'): return f'leg_{side}_knee'
    if ob.name.startswith('forearm'): return f'leg_{side}_ankle'
    if ob.name.startswith('shoulder.out'): return f'leg_{side}_hip'
    if ob.name.startswith('shoulder'): return f'leg_{side}_hip'
    if ob.name in ['body.up','back.plastin','cap','bolt.cap'] or ob.name.startswith('light.'): return 'turret'
    return mapping.get(ob.parent_bone,'chassis')

def texture(filename, size, *, color=False, jpeg=False):
    image=bpy.data.images.load(os.path.join(SOURCE,'original','textures',filename),check_existing=False)
    image.colorspace_settings.name='sRGB' if color else 'Non-Color'
    image.scale(size,size)
    path=os.path.join(SOURCE,'optimized-textures',filename.replace('.png','').replace('@channels=','-')+('-color' if color else '')+('.jpg' if jpeg else '.png'))
    image.filepath_raw=path
    image.file_format='JPEG' if jpeg else 'PNG'
    image.save()
    return image

base=texture('BaseColor.png',1024,color=True,jpeg=True)
metal=texture('Metallic_png-Roughness_png@channels=B.png',512)
rough=texture('Metallic_png-Roughness_png@channels=G.png',512)
normal=texture('Normal.png',1024)
mat=bpy.data.materials.new('Automaton_Armor_PBR'); mat.use_nodes=True;mat.use_backface_culling=True
nodes=mat.node_tree.nodes; links=mat.node_tree.links
principled=nodes.get('Principled BSDF')
for image,socket in [(base,'Base Color'),(metal,'Metallic'),(rough,'Roughness')]:
    n=nodes.new('ShaderNodeTexImage'); n.image=image
    links.new(n.outputs['Color'],principled.inputs[socket])
n=nodes.new('ShaderNodeTexImage');n.image=normal
nm=nodes.new('ShaderNodeNormalMap');nm.inputs['Strength'].default_value=.7
links.new(n.outputs['Color'],nm.inputs['Color']);links.new(nm.outputs['Normal'],principled.inputs['Normal'])
lamps={}
for channel,color in [('Health',(.08,.80,.27,1)),('Status',(1,.30,.05,1)),('Reactor',(1,.30,.05,1))]:
    lamp=bpy.data.materials.new('Automaton_Lenses_'+channel);lamp.use_nodes=True;lamp.use_backface_culling=True
    lamp['signalChannel']=channel.lower()
    p=lamp.node_tree.nodes.get('Principled BSDF')
    p.inputs['Base Color'].default_value=color
    p.inputs['Metallic'].default_value=.25;p.inputs['Roughness'].default_value=.22
    p.inputs['Emission Color'].default_value=color;p.inputs['Emission Strength'].default_value=1.5
    lamps[channel]=lamp
signal_sources={'light.up':'Health','light.down':'Status','front.sphere':'Reactor'}

deps=bpy.context.evaluated_depsgraph_get()
pieces=[]; bindings={}
for old in old_meshes:
    mesh=bpy.data.meshes.new_from_object(old.evaluated_get(deps),preserve_all_data_layers=True,depsgraph=deps)
    mesh.transform(normalize @ old.matrix_world)
    if old.matrix_world.determinant() < 0:
        mesh.flip_normals()
    piece=bpy.data.objects.new('part_'+old.name,mesh);bpy.context.collection.objects.link(piece)
    mesh.materials.clear();mesh.materials.append(lamps[signal_sources[old.name]] if old.name in signal_sources else mat)
    for face in mesh.polygons: face.material_index=0
    bone=bind_for(old);bindings[old.name]=bone
    g=piece.vertex_groups.new(name=bone);g.add(list(range(len(mesh.vertices))),1,'REPLACE')
    pieces.append(piece)
for ob in list(bpy.data.objects):
    if ob not in pieces: bpy.data.objects.remove(ob,do_unlink=True)

arm_data=bpy.data.armatures.new('Automaton_Combat_Rig')
arm=bpy.data.objects.new('Automaton_Rig',arm_data);bpy.context.collection.objects.link(arm)
bpy.context.view_layer.objects.active=arm;arm.select_set(True)
bpy.ops.object.mode_set(mode='EDIT')
for name,d in bones.items():
    b=arm_data.edit_bones.new(name);b.head=d['head'];b.tail=d['tail']
    if d['parent']: b.parent=arm_data.edit_bones[d['parent']]
# Explicit toe-end markers make runtime CCD solve the actual end of each foot.
for side in legs:
    parent=arm_data.edit_bones[f'leg_{side}_foot']
    tip=arm_data.edit_bones.new(f'leg_{side}_tip');tip.head=parent.tail;tip.tail=tip.head+Vector((0,0,.08));tip.parent=parent
    tip.use_deform=False
bpy.ops.object.mode_set(mode='OBJECT');arm.select_set(False)
for ob in pieces: ob.select_set(True)
bpy.context.view_layer.objects.active=pieces[0];bpy.ops.object.join()
skin=bpy.context.object;skin.name='Automaton_Beetle_Skin'
skin.parent=arm
mod=skin.modifiers.new('Rigid articulated skeleton','ARMATURE');mod.object=arm
for bone in arm.pose.bones: bone.rotation_mode='QUATERNION'
arm.show_in_front=True
arm['rig_notes']='Rigid mechanical skin: 18 weighted joints + four toe targets. Source-authentic geometry. Runtime CCD gait and combat poses are implemented in src/robot.js.'
arm['forward_axis']='Blender -Y; glTF +Z; runtime rotates to game +X'
bpy.ops.object.select_all(action='DESELECT');arm.select_set(True);skin.select_set(True)
bpy.context.view_layer.objects.active=arm
bpy.ops.wm.save_as_mainfile(filepath=os.path.join(SOURCE,'Automaton-Combat-Rig.blend'))
bpy.ops.export_scene.gltf(filepath=os.path.join(OUT,'automaton.glb'),export_format='GLB',use_selection=True,export_animations=False,export_apply=False,export_yup=True,export_extras=True,export_image_format='AUTO',export_jpeg_quality=88)

def gltf(v):return [v.x,v.z,-v.y]
metadata={'height':2.4,'original_floor':floor,'source_scale':scale,'forward':'+Z','mesh_vertices':len(skin.data.vertices),'triangles':sum(len(p.vertices)-2 for p in skin.data.polygons),'bones':{n:{'head':gltf(d['head']),'tail':gltf(d['tail']),'parent':d['parent']} for n,d in bones.items()},'bindings':bindings,'signal_channels':{channel.lower():{'source_object':name,'material':'Automaton_Lenses_'+channel,'bone':bindings[name]} for name,channel in signal_sources.items()}}
with open(os.path.join(OUT,'automaton-rig.json'),'w',encoding='utf8') as f: json.dump(metadata,f,indent=2)

# Native visual QA: clean three-quarter image of the delivered, repaired skin.
scene=bpy.context.scene;scene.render.engine='CYCLES';scene.cycles.samples=24
scene.render.resolution_x=960;scene.render.resolution_y=960;scene.render.resolution_percentage=100
scene.world.color=(.12,.12,.12)
scene.world.use_nodes=True;world=scene.world.node_tree.nodes.get('Background');world.inputs[0].default_value=(.08,.10,.14,1);world.inputs[1].default_value=.5
def area(name,loc,energy,color,size):
    d=bpy.data.lights.new(name,'AREA');d.energy=energy;d.color=color;d.shape='DISK';d.size=size
    o=bpy.data.objects.new(name,d);bpy.context.collection.objects.link(o);o.location=loc;o.rotation_euler=(Vector((0,0,1.1))-o.location).to_track_quat('-Z','Y').to_euler()
area('QA_Key',(3,-4,6),750,(1,.8,.61),5)
area('QA_Fill',(-4,-1,3),650,(.4,.7,1),4)
area('QA_Rim',(1,4,5),1000,(.4,.8,1),3)
bpy.ops.mesh.primitive_plane_add(size=200,location=(0,0,-.014));ground=bpy.context.object
floor_mat=bpy.data.materials.new('QA_Floor');floor_mat.diffuse_color=(.018,.025,.036,1);ground.data.materials.append(floor_mat)
camera_data=bpy.data.cameras.new('QA_Camera');camera=bpy.data.objects.new('QA_Camera',camera_data);bpy.context.collection.objects.link(camera)
camera.location=(4,-7,3.8);camera.rotation_euler=(Vector((0,0,1.15))-camera.location).to_track_quat('-Z','Y').to_euler();camera.data.type='ORTHO';camera.data.ortho_scale=3.75;scene.camera=camera
scene.view_settings.view_transform='AgX'
scene.render.filepath=os.path.join(SOURCE,'automaton-rig-preview.png');bpy.ops.render.render(write_still=True)
print('EXPORTED',os.path.join(OUT,'automaton.glb'),metadata['triangles'],'triangles',len(arm.data.bones),'bones')
