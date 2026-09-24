"""Verify all baked signal drivers against runtime samples, without rendering."""
import bpy, json, os
ROOT=os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
with open(os.path.join(ROOT,'assets-source','combat-animation-library.json'),encoding='utf8') as f: data=json.load(f)
arm=bpy.data.objects['Automaton_Rig']
reactor=bpy.data.objects.get('Original_Reactor_Skin')
if reactor:
    assert len(bpy.data.objects['Automaton_Beetle_Skin'].data.vertices)>5000,'Extraction must not move the complete skin.'
    assert 20<len(reactor.data.vertices)<1000,'Only original reactor geometry should separate.'
    assert all(reactor.data.materials[p.material_index].name.startswith('Automaton_Lenses_Reactor') for p in reactor.data.polygons)
for clip in data['clips']:
    arm.animation_data.action=bpy.data.actions['Combat_'+clip['name'].title()]
    for index in [0,len(clip['signals'])//2,len(clip['signals'])-1]:
        bpy.context.scene.frame_set(index+1)
        bpy.context.view_layer.update()
        for channel,signal in clip['signals'][index].items():
            shader=bpy.data.materials['Automaton_Lenses_'+channel.title()].node_tree.nodes.get('Principled BSDF')
            actual=[*shader.inputs['Emission Color'].default_value[:3],shader.inputs['Emission Strength'].default_value]
            expected=[*signal['color'],signal['intensity']]
            assert all(abs(a-b)<.0001 for a,b in zip(actual,expected)),f'{clip["name"]}/{index}/{channel}: {actual} vs {expected}'
print('Verified signal drivers on all',len(data['clips']),'native actions.')
