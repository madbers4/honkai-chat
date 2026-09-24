import bpy, json, os
from mathutils import Vector

root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
data = {'objects': [], 'images': [], 'materials': []}
for ob in bpy.data.objects:
    row = {'name': ob.name, 'type': ob.type, 'location': list(ob.location), 'rotation': list(ob.rotation_euler), 'scale': list(ob.scale), 'parent': ob.parent.name if ob.parent else None, 'parent_type':ob.parent_type, 'parent_bone':ob.parent_bone}
    if ob.type == 'MESH':
        corners = [ob.matrix_world @ Vector(c) for c in ob.bound_box]
        row.update(vertices=len(ob.data.vertices), polygons=len(ob.data.polygons), min=[min(c[i] for c in corners) for i in range(3)], max=[max(c[i] for c in corners) for i in range(3)], groups=[g.name for g in ob.vertex_groups], materials=[s.material.name if s.material else None for s in ob.material_slots], modifiers=[{'name':m.name,'type':m.type} for m in ob.modifiers])
    if ob.type == 'ARMATURE':
        row['bones'] = [{'name': b.name, 'parent':b.parent.name if b.parent else None, 'head':list(b.head_local), 'tail':list(b.tail_local), 'pose_quaternion':list(ob.pose.bones[b.name].rotation_quaternion), 'constraints': [{'type':c.type,'target':c.target.name if hasattr(c,'target') and c.target else None, 'subtarget':c.subtarget if hasattr(c,'subtarget') else None} for c in ob.pose.bones[b.name].constraints]} for b in ob.data.bones]
    data['objects'].append(row)
for im in bpy.data.images:
    data['images'].append({'name':im.name,'filepath':im.filepath,'size':list(im.size),'packed':bool(im.packed_file)})
for mat in bpy.data.materials:
    data['materials'].append({'name':mat.name,'nodes':[{'type': n.type, 'name': n.name, 'image': n.image.name if n.type=='TEX_IMAGE' and n.image else None} for n in mat.node_tree.nodes] if mat.use_nodes else []})
with open(os.path.join(root, 'assets-source/model-inspection.json'),'w',encoding='utf8') as f: json.dump(data, f, indent=2)
print(json.dumps(data, indent=2))
