"""Authoring scene with all original rigid chunks and three deterministic takes.
Run on Automaton-Combat-Rig.blend. Saves a separate file; never rewrites that rig.
"""
import bpy,os,json
from mathutils import Vector,Matrix
ROOT=os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
with open(os.path.join(ROOT,'assets-source','combat-fragment-library.json'),encoding='utf8') as f: library=json.load(f)
for obj in list(bpy.data.objects): bpy.data.objects.remove(obj,do_unlink=True)
for action in list(bpy.data.actions): bpy.data.actions.remove(action)
C=Matrix(((1,0,0,0),(0,0,-1,0),(0,1,0,0),(0,0,0,1)))
def vec(values): return Vector((values[0],-values[2],values[1]))
objects=[]
for item in library['meshes']:
    vertices=[vec(item['position'][i:i+3]) for i in range(0,len(item['position']),3)]
    mesh=bpy.data.meshes.new(item['name']);mesh.from_pydata(vertices,[],[list(range(i,i+3)) for i in range(0,len(vertices),3)]);mesh.update()
    material=bpy.data.materials[item['material']].copy();material.name='Wreck_'+item['material'];material.node_tree.animation_data_clear()
    shader=material.node_tree.nodes.get('Principled BSDF');shader.inputs['Emission Strength'].default_value=0
    mesh.materials.append(material);uv=mesh.uv_layers.new(name='UVMap')
    for loop in mesh.loops: uv.data[loop.index].uv=item['uv'][loop.vertex_index*2:loop.vertex_index*2+2]
    for face in mesh.polygons: face.use_smooth=True
    mesh.normals_split_custom_set_from_vertices([vec(item['normal'][i:i+3]) for i in range(0,len(item['normal']),3)])
    obj=bpy.data.objects.new(item['name'],mesh);bpy.context.collection.objects.link(obj);obj.rotation_mode='QUATERNION';obj.animation_data_create();objects.append(obj)
    obj['source']='Original supplied rigid-weighted mesh triangles, source bone/material in object name.'
for clip in library['clips']:
    for index,obj in enumerate(objects):
        action=bpy.data.actions.new('Destruction_'+clip['name']+'_'+str(index).zfill(2));action.use_fake_user=True;obj.animation_data.action=action
        for frame,matrices in enumerate(clip['frames']):
            values=matrices[index];transform=Matrix([values[i:i+4] for i in range(0,16,4)]).transposed()
            obj.matrix_world=C@transform@C.inverted()
            obj.keyframe_insert('location',frame=frame+1);obj.keyframe_insert('rotation_quaternion',frame=frame+1);obj.keyframe_insert('scale',frame=frame+1)
        for curve in action.fcurves:
            for key in curve.keyframe_points:key.interpolation='LINEAR'
        track=obj.animation_data.nla_tracks.new();track.name=clip['name'];track.strips.new(clip['name'],1,action);track.mute=clip['name']!='overload'
        obj.animation_data.action=None
scene=bpy.context.scene;scene.render.fps=30;scene.frame_start=1;scene.frame_end=121;scene.frame_set(1)
scene['How to review']='Select all fragments; enable the same named NLA track on each. overload enabled, coreRip/brutality muted. Frame1 rupture origin; frame121 settled wreck. All pieces are original triangles, no primitives.'
bpy.ops.file.pack_all();bpy.ops.wm.save_as_mainfile(filepath=os.path.join(ROOT,'assets-source','Automaton-Destruction-Library.blend'))
print('Saved editable original-mesh destruction library:',len(objects),'pieces,',len(library['clips']),'takes.')
